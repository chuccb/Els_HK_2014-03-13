import { divFix, mulDiv, mulDivNoRound, mulFix } from "./calc.ts";
import type { FtFace } from "./face.ts";
import { dispatch, OPCODE_LENGTH, POP_PUSH_COUNT } from "./interp-tables.ts";
import type { FtSize } from "./size.ts";
import { sqrtFixed as _unused, vectorLength } from "./trig.ts";
import {
  type CodeRange,
  type DefRecord,
  GlyphZone,
  type GraphicsState,
  type SizeMetrics,
  type TtSizeMetrics,
  cloneGraphicsState,
  cloneSizeMetrics,
  cloneTtSizeMetrics,
  newDefaultGraphicsState,
  newSizeMetrics,
  newTtSizeMetrics,
  TT_CODERANGE,
} from "./ttypes.ts";
import { FtErr, FT_CURVE_TAG } from "./types.ts";

void _unused;

/**
 * The TrueType bytecode interpreter of FreeType 2.4.11 (src/truetype/ttinterp.c, version 35, no subpixel hinting: TT_CONFIG_OPTION_SUBPIXEL_HINTING is not
 * defined in the exe's build and `sph_*` fields do not exist).  `TtExec` is TT_ExecContextRec: the driver owns ONE of them and every face and size of the
 * library runs on it (TT_New_Context), so state that survives between glyphs -- `grayscale`, the stack and glyph-instruction buffer sizes -- is kept.
 *
 * Conventions: all values are 32-bit (FT_Long is `long` on Win32): results of `+ - *` are wrapped with `| 0` / Math.imul; `/` truncates toward zero; FT_UShort /
 * FT_Short parameters are cut with `& 0xffff` / `<< 16 >> 16`.  `args` is the index of the first argument on `stack` (the C `FT_Long* args`).  Instruction
 * methods are named `ins<NAME>` after `Ins_<NAME>` and are called by `dispatch` (generated, interp-tables.ts).  An error is `this.error`; a method that C
 * leaves with `return` simply returns.  Parts of the file follow the C order.
 */

const SUCCESS = 0;
const FAILURE = 1;
const MAX_RUNNABLE_OPCODES = 1000000;

// TT_Round_*
const ROUND_TO_HALF_GRID = 0;
const ROUND_TO_GRID = 1;
const ROUND_TO_DOUBLE_GRID = 2;
const ROUND_DOWN_TO_GRID = 3;
const ROUND_UP_TO_GRID = 4;
const ROUND_OFF = 5;
const ROUND_SUPER = 6;
const ROUND_SUPER_45 = 7;

const TOUCH_X = FT_CURVE_TAG.TOUCH_X;
const TOUCH_Y = FT_CURVE_TAG.TOUCH_Y;
const TOUCH_BOTH = TOUCH_X | TOUCH_Y;
const TAG_ON = FT_CURVE_TAG.ON;

/** BOUNDS / BOUNDSL: `(FT_UInt)x >= (FT_UInt)n` */
const bounds = (x: number, n: number): boolean => x >>> 0 >= n >>> 0;
const abs = (x: number): number => (x < 0 ? -x | 0 : x);
const int16 = (x: number): number => (x << 16) >> 16;
const pixFloor = (x: number): number => x & ~63;
const pixRound = (x: number): number => (x + 32) & ~63;
const pixCeil = (x: number): number => (x + 63) & ~63;
/** C `/` on int */
const idiv = (a: number, b: number): number => Math.trunc(a / b) | 0;

/** TT_MulFix14 (ttinterp.c, the `#if 1` version): a * b / 0x4000 with rounding, ties away from zero */
export function ttMulFix14(a: number, b: number): number {
  const sign = a ^ b;
  if (a < 0) a = -a | 0;
  if (b < 0) b = -b | 0;
  const ah = (a >> 16) & 0xffff;
  const al = a & 0xffff;
  const lo = Math.imul(al, b) >>> 0;
  let mid = Math.imul(ah, b) >>> 0;
  let hi = mid >>> 16;
  mid = ((mid << 16) + (1 << 13)) >>> 0;
  const lo2 = (lo + mid) >>> 0;
  if (lo2 < mid) hi += 1;
  const r = ((lo2 >>> 14) | (hi << 18)) | 0;
  return sign >= 0 ? r : -r | 0;
}

/** TT_DotFix14: (ax * bx + ay * by) / 0x4000 rounded, with a 64-bit intermediate */
export function ttDotFix14(ax: number, ay: number, bx: number, by: number): number {
  let l = Math.imul(ax & 0xffff, bx) >>> 0;
  let m = Math.imul(ax >> 16, bx);
  const lo1 = (l + ((m << 16) >>> 0)) >>> 0;
  const hi1 = ((m >> 16) + ((l | 0) >> 31) + (lo1 < l ? 1 : 0)) | 0;
  l = Math.imul(ay & 0xffff, by) >>> 0;
  m = Math.imul(ay >> 16, by);
  const lo2 = (l + ((m << 16) >>> 0)) >>> 0;
  const hi2 = ((m >> 16) + ((l | 0) >> 31) + (lo2 < l ? 1 : 0)) | 0;
  const lo = (lo1 + lo2) >>> 0;
  let hi = (hi1 + hi2 + (lo < lo1 ? 1 : 0)) | 0;
  const s = hi >> 31;
  l = (lo + (s >>> 0)) >>> 0;
  hi = (hi + s + (l < lo ? 1 : 0)) | 0;
  const lo3 = l;
  l = (lo3 + 0x2000) >>> 0;
  hi = (hi + (l < lo3 ? 1 : 0)) | 0;
  return ((hi << 18) | (l >>> 14)) | 0;
}

/** TT_DivFix14( a, b ) = FT_DivFix( a, b << 2 ) */
const ttDivFix14 = (a: number, b: number): number => divFix(a, (b << 2) | 0);

/** a unit vector kept as two int16 (FT_UnitVector) */
interface UnitVector {
  x: number;
  y: number;
}

/** TT_CallRec */
interface CallRec {
  callerRange: number;
  callerIP: number;
  curCount: number;
  curRestart: number;
  curEnd: number;
}

// func_project / func_dualproj
const PROJ_GENERAL = 0;
const PROJ_X = 1;
const PROJ_Y = 2;
// func_move / func_move_orig
const MOVE_GENERAL = 0;
const MOVE_X = 1;
const MOVE_Y = 2;

export class TtExec {
  face: FtFace | null = null;
  size: FtSize | null = null;
  error = 0;
  top = 0;
  stackSize = 0;
  stack: Int32Array = new Int32Array(0);
  args = 0;
  newTop = 0;
  zp0 = new GlyphZone();
  zp1 = new GlyphZone();
  zp2 = new GlyphZone();
  pts = new GlyphZone();
  twilight = new GlyphZone();
  metrics: SizeMetrics = newSizeMetrics();
  ttMetrics: TtSizeMetrics = newTtSizeMetrics();
  GS: GraphicsState = newDefaultGraphicsState();
  curRange = 0;
  code: Uint8Array = new Uint8Array(0);
  IP = 0;
  codeSize = 0;
  opcode = 0;
  length = 0;
  stepIns = false;
  cvtSize = 0;
  cvt: Int32Array = new Int32Array(0);
  glyphSize = 0;
  glyphIns: Uint8Array = new Uint8Array(0);
  numFDefs = 0;
  maxFDefs = 0;
  FDefs: DefRecord[] = [];
  numIDefs = 0;
  maxIDefs = 0;
  IDefs: DefRecord[] = [];
  maxFunc = 0;
  maxIns = 0;
  callTop = 0;
  callSize = 32;
  callStack: CallRec[] = Array.from({ length: 32 }, () => ({ callerRange: 0, callerIP: 0, curCount: 0, curRestart: 0, curEnd: 0 }));
  codeRangeTable: CodeRange[] = [
    { base: null, size: 0 },
    { base: null, size: 0 },
    { base: null, size: 0 },
  ];
  storeSize = 0;
  storage: Int32Array = new Int32Array(0);
  period = 0;
  phase = 0;
  threshold = 0;
  instructionTrap = false;
  isComposite = false;
  pedanticHinting = false;
  FdotP = 0;
  // function pointers as small integers
  funcRound = ROUND_TO_GRID;
  funcProject = PROJ_GENERAL;
  funcDualproj = PROJ_GENERAL;
  funcMove = MOVE_GENERAL;
  funcMoveOrig = MOVE_GENERAL;
  /** 0 = Read_CVT / Write_CVT / Move_CVT, 1 = the _Stretched versions */
  cvtStretched = false;
  grayscale = false;

  // ------------------------------------------------------------------------------------------------------------------------------ code ranges

  /** TT_Goto_CodeRange */
  gotoCodeRange(range: number, ip: number): number {
    const cr = this.codeRangeTable[range - 1]!;
    this.code = cr.base!;
    this.codeSize = cr.size;
    this.IP = ip;
    this.curRange = range;
    return FtErr.Ok;
  }

  /** TT_Set_CodeRange */
  setCodeRange(range: number, base: Uint8Array | null, length: number): number {
    this.codeRangeTable[range - 1] = { base, size: length };
    return FtErr.Ok;
  }

  /** TT_Clear_CodeRange */
  clearCodeRange(range: number): number {
    this.codeRangeTable[range - 1] = { base: null, size: 0 };
    return FtErr.Ok;
  }

  // -------------------------------------------------------------------------------------------------------------------------------- context

  /** TT_Load_Context */
  loadContext(face: FtFace, size: FtSize | null): number {
    this.face = face;
    const maxp = face.maxProfile;
    this.size = size;
    if (size) {
      this.numFDefs = size.numFunctionDefs;
      this.maxFDefs = size.maxFunctionDefs;
      this.numIDefs = size.numInstructionDefs;
      this.maxIDefs = size.maxInstructionDefs;
      this.FDefs = size.functionDefs;
      this.IDefs = size.instructionDefs;
      this.ttMetrics = cloneTtSizeMetrics(size.ttmetrics);
      this.metrics = cloneSizeMetrics(size.scaled);
      this.maxFunc = size.maxFunc;
      this.maxIns = size.maxIns;
      for (let i = 0; i < 3; i++) this.codeRangeTable[i] = { ...size.codeRangeTable[i]! };
      this.GS = cloneGraphicsState(size.GS);
      this.cvtSize = size.cvt.length;
      this.cvt = size.cvt;
      this.storeSize = size.storage.length;
      this.storage = size.storage;
      this.twilight.assign(size.twilight);
      this.zp0.clear();
      this.zp1.clear();
      this.zp2.clear();
    }
    // Update_Max: the buffers only grow (and the library's one context is shared by every face)
    const wantStack = maxp.maxStackElements + 32;
    if (this.stackSize < wantStack) {
      const s = new Int32Array(wantStack);
      s.set(this.stack);
      this.stack = s;
      this.stackSize = wantStack;
    }
    if (this.glyphSize < maxp.maxSizeOfInstructions) {
      const g = new Uint8Array(maxp.maxSizeOfInstructions);
      g.set(this.glyphIns);
      this.glyphIns = g;
    }
    this.glyphSize = Math.max(this.glyphSize, maxp.maxSizeOfInstructions) & 0xffff;
    this.pts.nPoints = 0;
    this.pts.nContours = 0;
    this.zp1.assign(this.pts);
    this.zp2.assign(this.pts);
    this.zp0.assign(this.pts);
    this.instructionTrap = false;
    return FtErr.Ok;
  }

  /** TT_Save_Context */
  saveContext(size: FtSize): number {
    size.numFunctionDefs = this.numFDefs;
    size.numInstructionDefs = this.numIDefs;
    size.maxFunc = this.maxFunc;
    size.maxIns = this.maxIns;
    for (let i = 0; i < 3; i++) size.codeRangeTable[i] = { ...this.codeRangeTable[i]! };
    return FtErr.Ok;
  }

  /** TT_Run_Context */
  runContext(): number {
    const e = this.gotoCodeRange(TT_CODERANGE.GLYPH, 0);
    if (e !== FtErr.Ok) return e;
    this.zp0.assign(this.pts);
    this.zp1.assign(this.pts);
    this.zp2.assign(this.pts);
    this.GS.gep0 = 1;
    this.GS.gep1 = 1;
    this.GS.gep2 = 1;
    this.GS.projVector.x = 0x4000;
    this.GS.projVector.y = 0x0000;
    this.GS.freeVector = { x: this.GS.projVector.x, y: this.GS.projVector.y };
    this.GS.dualVector = { x: this.GS.projVector.x, y: this.GS.projVector.y };
    this.GS.roundState = 1;
    this.GS.loop = 1;
    this.top = 0;
    this.callTop = 0;
    return this.runIns();
  }

  // --------------------------------------------------------------------------------------------------------------------------- ratio, ppem

  /** Current_Ratio */
  currentRatio(): number {
    const m = this.ttMetrics;
    if (!m.ratio) {
      if (this.GS.projVector.y === 0) m.ratio = m.xRatio;
      else if (this.GS.projVector.x === 0) m.ratio = m.yRatio;
      else {
        const x = ttMulFix14(m.xRatio, this.GS.projVector.x);
        const y = ttMulFix14(m.yRatio, this.GS.projVector.y);
        m.ratio = vectorLength(x, y);
      }
    }
    return m.ratio;
  }

  /** Current_Ppem */
  currentPpem(): number {
    return mulFix(this.ttMetrics.ppem, this.currentRatio());
  }

  readCvt(idx: number): number {
    return this.cvtStretched ? mulFix(this.cvt[idx]!, this.currentRatio()) : this.cvt[idx]!;
  }
  writeCvt(idx: number, value: number): void {
    this.cvt[idx] = this.cvtStretched ? divFix(value, this.currentRatio()) : value;
  }
  moveCvt(idx: number, value: number): void {
    this.cvt[idx] = (this.cvt[idx]! + (this.cvtStretched ? divFix(value, this.currentRatio()) : value)) | 0;
  }

  /** GetShortIns */
  getShortIns(): number {
    this.IP += 2;
    return int16((this.code[this.IP - 2]! << 8) + this.code[this.IP - 1]!);
  }

  /** Ins_Goto_CodeRange: SUCCESS / FAILURE */
  insGotoCodeRange(aRange: number, aIP: number): number {
    if (aRange < 1 || aRange > 3) {
      this.error = FtErr.Bad_Argument;
      return FAILURE;
    }
    const range = this.codeRangeTable[aRange - 1]!;
    if (range.base === null) {
      this.error = FtErr.Invalid_CodeRange;
      return FAILURE;
    }
    if (aIP >>> 0 > range.size) {
      this.error = FtErr.Code_Overflow;
      return FAILURE;
    }
    this.code = range.base;
    this.codeSize = range.size;
    this.IP = aIP;
    this.curRange = aRange;
    return SUCCESS;
  }

  // ------------------------------------------------------------------------------------------------------------------------ point movement

  /** the function selected by func_move: Direct_Move / Direct_Move_X / Direct_Move_Y */
  move(zone: GlyphZone, point: number, distance: number): void {
    switch (this.funcMove) {
      case MOVE_X:
        zone.cur[2 * point] = (zone.cur[2 * point]! + distance) | 0;
        zone.tags[point]! |= TOUCH_X;
        return;
      case MOVE_Y:
        zone.cur[2 * point + 1] = (zone.cur[2 * point + 1]! + distance) | 0;
        zone.tags[point]! |= TOUCH_Y;
        return;
      default: {
        let v = this.GS.freeVector.x;
        if (v !== 0) {
          zone.cur[2 * point] = (zone.cur[2 * point]! + mulDiv(distance, v, this.FdotP)) | 0;
          zone.tags[point]! |= TOUCH_X;
        }
        v = this.GS.freeVector.y;
        if (v !== 0) {
          zone.cur[2 * point + 1] = (zone.cur[2 * point + 1]! + mulDiv(distance, v, this.FdotP)) | 0;
          zone.tags[point]! |= TOUCH_Y;
        }
      }
    }
  }

  /** func_move_orig */
  moveOrig(zone: GlyphZone, point: number, distance: number): void {
    switch (this.funcMoveOrig) {
      case MOVE_X:
        zone.org[2 * point] = (zone.org[2 * point]! + distance) | 0;
        return;
      case MOVE_Y:
        zone.org[2 * point + 1] = (zone.org[2 * point + 1]! + distance) | 0;
        return;
      default: {
        let v = this.GS.freeVector.x;
        if (v !== 0) zone.org[2 * point] = (zone.org[2 * point]! + mulDiv(distance, v, this.FdotP)) | 0;
        v = this.GS.freeVector.y;
        if (v !== 0) zone.org[2 * point + 1] = (zone.org[2 * point + 1]! + mulDiv(distance, v, this.FdotP)) | 0;
      }
    }
  }

  // --------------------------------------------------------------------------------------------------------------------------- rounding

  /** CUR_Func_round: the Round_* function selected by Compute_Round / the RTG family */
  round(distance: number, compensation: number): number {
    let val: number;
    switch (this.funcRound) {
      case ROUND_OFF:
        return this.roundNone(distance, compensation);
      case ROUND_TO_GRID:
        if (distance >= 0) {
          val = (distance + compensation + 32) | 0;
          if (distance && val > 0) val &= ~63;
          else val = 0;
        } else {
          val = -pixRound((compensation - distance) | 0) | 0;
          if (val > 0) val = 0;
        }
        return val;
      case ROUND_TO_HALF_GRID:
        if (distance >= 0) {
          val = (pixFloor((distance + compensation) | 0) + 32) | 0;
          if (distance && val < 0) val = 0;
        } else {
          val = -((pixFloor((compensation - distance) | 0) + 32) | 0) | 0;
          if (val > 0) val = 0;
        }
        return val;
      case ROUND_DOWN_TO_GRID:
        if (distance >= 0) {
          val = (distance + compensation) | 0;
          if (distance && val > 0) val &= ~63;
          else val = 0;
        } else {
          val = -((((compensation - distance) | 0) & -64) | 0) | 0;
          if (val > 0) val = 0;
        }
        return val;
      case ROUND_UP_TO_GRID:
        if (distance >= 0) {
          val = (distance + compensation + 63) | 0;
          if (distance && val > 0) val &= ~63;
          else val = 0;
        } else {
          val = -pixCeil((compensation - distance) | 0) | 0;
          if (val > 0) val = 0;
        }
        return val;
      case ROUND_TO_DOUBLE_GRID:
        if (distance >= 0) {
          val = (distance + compensation + 16) | 0;
          if (distance && val > 0) val &= ~31;
          else val = 0;
        } else {
          val = -(((compensation - distance + 32 / 2) | 0) & ~(32 - 1)) | 0; // FT_PAD_ROUND( x, 32 ) = ( x + 16 ) & ~31
          if (val > 0) val = 0;
        }
        return val;
      case ROUND_SUPER:
        if (distance >= 0) {
          val = ((distance - this.phase + this.threshold + compensation) & -this.period) | 0;
          if (distance && val < 0) val = 0;
          val = (val + this.phase) | 0;
        } else {
          val = -(((this.threshold - this.phase - distance + compensation) & -this.period) | 0) | 0;
          if (val > 0) val = 0;
          val = (val - this.phase) | 0;
        }
        return val;
      default: // ROUND_SUPER_45
        if (distance >= 0) {
          val = Math.imul(idiv((distance - this.phase + this.threshold + compensation) | 0, this.period), this.period);
          if (distance && val < 0) val = 0;
          val = (val + this.phase) | 0;
        } else {
          val = -Math.imul(idiv((this.threshold - this.phase - distance + compensation) | 0, this.period), this.period) | 0;
          if (val > 0) val = 0;
          val = (val - this.phase) | 0;
        }
        return val;
    }
  }

  /** Round_None */
  roundNone(distance: number, compensation: number): number {
    let val: number;
    if (distance >= 0) {
      val = (distance + compensation) | 0;
      if (distance && val < 0) val = 0;
    } else {
      val = (distance - compensation) | 0;
      if (val > 0) val = 0;
    }
    return val;
  }

  /** Compute_Round */
  computeRound(mode: number): void {
    switch (mode & 0xff) {
      case ROUND_OFF:
      case ROUND_TO_GRID:
      case ROUND_UP_TO_GRID:
      case ROUND_DOWN_TO_GRID:
      case ROUND_TO_HALF_GRID:
      case ROUND_TO_DOUBLE_GRID:
      case ROUND_SUPER:
      case ROUND_SUPER_45:
        this.funcRound = mode & 0xff;
        break;
    }
  }

  /** SetSuperRound */
  setSuperRound(gridPeriod: number, selector: number): void {
    switch (selector & 0xc0) {
      case 0:
        this.period = idiv(gridPeriod, 2);
        break;
      case 0x40:
        this.period = gridPeriod;
        break;
      case 0x80:
        this.period = (gridPeriod * 2) | 0;
        break;
      case 0xc0:
        this.period = gridPeriod;
        break;
    }
    switch (selector & 0x30) {
      case 0:
        this.phase = 0;
        break;
      case 0x10:
        this.phase = idiv(this.period, 4);
        break;
      case 0x20:
        this.phase = idiv(this.period, 2);
        break;
      case 0x30:
        this.phase = idiv(Math.imul(this.period, 3), 4);
        break;
    }
    if ((selector & 0x0f) === 0) this.threshold = (this.period - 1) | 0;
    else this.threshold = idiv(Math.imul((selector & 0x0f) - 4, this.period), 8);
    this.period = idiv(this.period, 256);
    this.phase = idiv(this.phase, 256);
    this.threshold = idiv(this.threshold, 256);
  }

  // ------------------------------------------------------------------------------------------------------------------------- projection

  /** CUR.func_project( dx, dy ) */
  project(dx: number, dy: number): number {
    switch (this.funcProject) {
      case PROJ_X:
        return dx;
      case PROJ_Y:
        return dy;
      default:
        return ttDotFix14(dx, dy, this.GS.projVector.x, this.GS.projVector.y);
    }
  }

  /** CUR.func_dualproj( dx, dy ) */
  dualProject(dx: number, dy: number): number {
    switch (this.funcDualproj) {
      case PROJ_X:
        return dx;
      case PROJ_Y:
        return dy;
      default:
        return ttDotFix14(dx, dy, this.GS.dualVector.x, this.GS.dualVector.y);
    }
  }

  /** CUR_Func_project( v1, v2 ): the points are (a[2 i], a[2 i + 1]) */
  projectPts(a: Int32Array, i: number, b: Int32Array, j: number): number {
    return this.project((a[2 * i]! - b[2 * j]!) | 0, (a[2 * i + 1]! - b[2 * j + 1]!) | 0);
  }
  dualProjectPts(a: Int32Array, i: number, b: Int32Array, j: number): number {
    return this.dualProject((a[2 * i]! - b[2 * j]!) | 0, (a[2 * i + 1]! - b[2 * j + 1]!) | 0);
  }

  /** Compute_Funcs */
  computeFuncs(): void {
    const g = this.GS;
    if (g.freeVector.x === 0x4000) this.FdotP = g.projVector.x;
    else if (g.freeVector.y === 0x4000) this.FdotP = g.projVector.y;
    else this.FdotP = (Math.imul(g.projVector.x, g.freeVector.x) + Math.imul(g.projVector.y, g.freeVector.y)) >> 14;
    if (g.projVector.x === 0x4000) this.funcProject = PROJ_X;
    else if (g.projVector.y === 0x4000) this.funcProject = PROJ_Y;
    else this.funcProject = PROJ_GENERAL;
    if (g.dualVector.x === 0x4000) this.funcDualproj = PROJ_X;
    else if (g.dualVector.y === 0x4000) this.funcDualproj = PROJ_Y;
    else this.funcDualproj = PROJ_GENERAL;
    this.funcMove = MOVE_GENERAL;
    this.funcMoveOrig = MOVE_GENERAL;
    if (this.FdotP === 0x4000) {
      if (g.freeVector.x === 0x4000) {
        this.funcMove = MOVE_X;
        this.funcMoveOrig = MOVE_X;
      } else if (g.freeVector.y === 0x4000) {
        this.funcMove = MOVE_Y;
        this.funcMoveOrig = MOVE_Y;
      }
    }
    if (abs(this.FdotP) < 0x400) this.FdotP = 0x4000;
    this.ttMetrics.ratio = 0;
  }

  /** Normalize: the unit vector of (Vx, Vy) into R; SUCCESS always (R is left alone for a null vector) */
  normalize(vx: number, vy: number, r: UnitVector): number {
    if (abs(vx) < 0x10000 && abs(vy) < 0x10000) {
      vx = Math.imul(vx, 0x100);
      vy = Math.imul(vy, 0x100);
      const w = vectorLength(vx, vy);
      if (w === 0) return SUCCESS;
      r.x = int16(ttDivFix14(vx, w));
      r.y = int16(ttDivFix14(vy, w));
      return SUCCESS;
    }
    let w = vectorLength(vx, vy);
    vx = ttDivFix14(vx, w);
    vy = ttDivFix14(vy, w);
    w = (Math.imul(vx, vx) + Math.imul(vy, vy)) | 0;
    let s1 = false;
    let s2 = false;
    if (vx < 0) {
      vx = -vx | 0;
      s1 = true;
    }
    if (vy < 0) {
      vy = -vy | 0;
      s2 = true;
    }
    while (w < 0x10000000) {
      if (vx < vy) vx++;
      else vy++;
      w = (Math.imul(vx, vx) + Math.imul(vy, vy)) | 0;
    }
    while (w >= 0x10004000) {
      if (vx < vy) vx--;
      else vy--;
      w = (Math.imul(vx, vx) + Math.imul(vy, vy)) | 0;
    }
    if (s1) vx = -vx | 0;
    if (s2) vy = -vy | 0;
    r.x = int16(vx);
    r.y = int16(vy);
    return SUCCESS;
  }

  /** Ins_SxVTL: SUCCESS / FAILURE */
  sxvtl(aIdx1: number, aIdx2: number, aOpc: number, vec: UnitVector): number {
    if (bounds(aIdx1, this.zp2.nPoints) || bounds(aIdx2, this.zp1.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return FAILURE;
    }
    let A = (this.zp1.cur[2 * aIdx2]! - this.zp2.cur[2 * aIdx1]!) | 0;
    let B = (this.zp1.cur[2 * aIdx2 + 1]! - this.zp2.cur[2 * aIdx1 + 1]!) | 0;
    if (A === 0 && B === 0) {
      A = 0x4000;
      aOpc = 0;
    }
    if ((aOpc & 1) !== 0) {
      const C = B;
      B = A;
      A = -C | 0;
    }
    return this.normalize(A, B, vec);
  }

  // =========================================================================================================================================
  // instructions (the order of ttinterp.c)
  // =========================================================================================================================================

  insSVTCA(_a: number): void {
    const A = (this.opcode & 1) << 14;
    const B = A ^ 0x4000;
    const g = this.GS;
    g.freeVector.x = A;
    g.projVector.x = A;
    g.dualVector.x = A;
    g.freeVector.y = B;
    g.projVector.y = B;
    g.dualVector.y = B;
    this.computeFuncs();
  }

  insSPVTCA(_a: number): void {
    const A = (this.opcode & 1) << 14;
    const B = A ^ 0x4000;
    const g = this.GS;
    g.projVector.x = A;
    g.dualVector.x = A;
    g.projVector.y = B;
    g.dualVector.y = B;
    this.computeFuncs();
  }

  insSFVTCA(_a: number): void {
    const A = (this.opcode & 1) << 14;
    const B = A ^ 0x4000;
    this.GS.freeVector.x = A;
    this.GS.freeVector.y = B;
    this.computeFuncs();
  }

  insSPVTL(a: number): void {
    const s = this.stack;
    if (this.sxvtl(s[a + 1]! & 0xffff, s[a]! & 0xffff, this.opcode, this.GS.projVector) === SUCCESS) {
      this.GS.dualVector = { x: this.GS.projVector.x, y: this.GS.projVector.y };
      this.computeFuncs();
    }
  }

  insSFVTL(a: number): void {
    const s = this.stack;
    if (this.sxvtl(s[a + 1]! & 0xffff, s[a]! & 0xffff, this.opcode, this.GS.freeVector) === SUCCESS) this.computeFuncs();
  }

  insSFVTPV(_a: number): void {
    this.GS.freeVector = { x: this.GS.projVector.x, y: this.GS.projVector.y };
    this.computeFuncs();
  }

  insSPVFS(a: number): void {
    const s = this.stack;
    const Y = int16(s[a + 1]!);
    const X = int16(s[a]!);
    this.normalize(X, Y, this.GS.projVector);
    this.GS.dualVector = { x: this.GS.projVector.x, y: this.GS.projVector.y };
    this.computeFuncs();
  }

  insSFVFS(a: number): void {
    const s = this.stack;
    const Y = int16(s[a + 1]!);
    const X = int16(s[a]!);
    this.normalize(X, Y, this.GS.freeVector);
    this.computeFuncs();
  }

  insGPV(a: number): void {
    this.stack[a] = this.GS.projVector.x;
    this.stack[a + 1] = this.GS.projVector.y;
  }

  insGFV(a: number): void {
    this.stack[a] = this.GS.freeVector.x;
    this.stack[a + 1] = this.GS.freeVector.y;
  }

  insSRP0(a: number): void {
    this.GS.rp0 = this.stack[a]! & 0xffff;
  }
  insSRP1(a: number): void {
    this.GS.rp1 = this.stack[a]! & 0xffff;
  }
  insSRP2(a: number): void {
    this.GS.rp2 = this.stack[a]! & 0xffff;
  }

  insRTHG(_a: number): void {
    this.GS.roundState = ROUND_TO_HALF_GRID;
    this.funcRound = ROUND_TO_HALF_GRID;
  }
  insRTG(_a: number): void {
    this.GS.roundState = ROUND_TO_GRID;
    this.funcRound = ROUND_TO_GRID;
  }
  insRTDG(_a: number): void {
    this.GS.roundState = ROUND_TO_DOUBLE_GRID;
    this.funcRound = ROUND_TO_DOUBLE_GRID;
  }
  insRUTG(_a: number): void {
    this.GS.roundState = ROUND_UP_TO_GRID;
    this.funcRound = ROUND_UP_TO_GRID;
  }
  insRDTG(_a: number): void {
    this.GS.roundState = ROUND_DOWN_TO_GRID;
    this.funcRound = ROUND_DOWN_TO_GRID;
  }
  insROFF(_a: number): void {
    this.GS.roundState = ROUND_OFF;
    this.funcRound = ROUND_OFF;
  }
  insSROUND(a: number): void {
    this.setSuperRound(0x4000, this.stack[a]!);
    this.GS.roundState = ROUND_SUPER;
    this.funcRound = ROUND_SUPER;
  }
  insS45ROUND(a: number): void {
    this.setSuperRound(0x2d41, this.stack[a]!);
    this.GS.roundState = ROUND_SUPER_45;
    this.funcRound = ROUND_SUPER_45;
  }

  insSLOOP(a: number): void {
    if (this.stack[a]! < 0) this.error = FtErr.Bad_Argument;
    else this.GS.loop = this.stack[a]!;
  }
  insSMD(a: number): void {
    this.GS.minimumDistance = this.stack[a]!;
  }
  insSCVTCI(a: number): void {
    this.GS.controlValueCutin = this.stack[a]!;
  }
  insSSWCI(a: number): void {
    this.GS.singleWidthCutin = this.stack[a]!;
  }
  insSSW(a: number): void {
    this.GS.singleWidthValue = mulFix(this.stack[a]!, this.ttMetrics.scale);
  }
  insFLIPON(_a: number): void {
    this.GS.autoFlip = true;
  }
  insFLIPOFF(_a: number): void {
    this.GS.autoFlip = false;
  }
  insSANGW(_a: number): void {}
  insSDB(a: number): void {
    this.GS.deltaBase = int16(this.stack[a]!);
  }
  insSDS(a: number): void {
    this.GS.deltaShift = int16(this.stack[a]!);
  }
  insMPPEM(a: number): void {
    this.stack[a] = this.currentPpem();
  }
  insMPS(a: number): void {
    this.stack[a] = this.currentPpem();
  }
  insDUP(a: number): void {
    this.stack[a + 1] = this.stack[a]!;
  }
  insPOP(_a: number): void {}
  insCLEAR(_a: number): void {
    this.newTop = 0;
  }
  insSWAP(a: number): void {
    const s = this.stack;
    const L = s[a]!;
    s[a] = s[a + 1]!;
    s[a + 1] = L;
  }
  insDEPTH(a: number): void {
    this.stack[a] = this.top;
  }
  insCINDEX(a: number): void {
    const s = this.stack;
    const L = s[a]!;
    if (L <= 0 || L > this.args) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      s[a] = 0;
    } else s[a] = s[this.args - L]!;
  }
  insEIF(_a: number): void {}

  /** the shared tail of JROT / JMPR / JROF */
  private jump(a: number): void {
    const s = this.stack;
    if (s[a]! === 0 && this.args === 0) this.error = FtErr.Bad_Argument;
    this.IP = (this.IP + s[a]!) | 0;
    if (this.IP < 0 || (this.callTop > 0 && this.IP > this.callStack[this.callTop - 1]!.curEnd)) this.error = FtErr.Bad_Argument;
    this.stepIns = false;
  }
  insJROT(a: number): void {
    if (this.stack[a + 1]! !== 0) this.jump(a);
  }
  insJMPR(a: number): void {
    this.jump(a);
  }
  insJROF(a: number): void {
    if (this.stack[a + 1]! === 0) this.jump(a);
  }

  insLT(a: number): void {
    this.stack[a] = this.stack[a]! < this.stack[a + 1]! ? 1 : 0;
  }
  insLTEQ(a: number): void {
    this.stack[a] = this.stack[a]! <= this.stack[a + 1]! ? 1 : 0;
  }
  insGT(a: number): void {
    this.stack[a] = this.stack[a]! > this.stack[a + 1]! ? 1 : 0;
  }
  insGTEQ(a: number): void {
    this.stack[a] = this.stack[a]! >= this.stack[a + 1]! ? 1 : 0;
  }
  insEQ(a: number): void {
    this.stack[a] = this.stack[a]! === this.stack[a + 1]! ? 1 : 0;
  }
  insNEQ(a: number): void {
    this.stack[a] = this.stack[a]! !== this.stack[a + 1]! ? 1 : 0;
  }
  insODD(a: number): void {
    this.stack[a] = (this.round(this.stack[a]!, 0) & 127) === 64 ? 1 : 0;
  }
  insEVEN(a: number): void {
    this.stack[a] = (this.round(this.stack[a]!, 0) & 127) === 0 ? 1 : 0;
  }
  insAND(a: number): void {
    this.stack[a] = this.stack[a]! && this.stack[a + 1]! ? 1 : 0;
  }
  insOR(a: number): void {
    this.stack[a] = this.stack[a]! || this.stack[a + 1]! ? 1 : 0;
  }
  insNOT(a: number): void {
    this.stack[a] = !this.stack[a]! ? 1 : 0;
  }
  insADD(a: number): void {
    this.stack[a] = (this.stack[a]! + this.stack[a + 1]!) | 0;
  }
  insSUB(a: number): void {
    this.stack[a] = (this.stack[a]! - this.stack[a + 1]!) | 0;
  }
  insDIV(a: number): void {
    if (this.stack[a + 1]! === 0) this.error = FtErr.Divide_By_Zero;
    else this.stack[a] = mulDivNoRound(this.stack[a]!, 64, this.stack[a + 1]!);
  }
  insMUL(a: number): void {
    this.stack[a] = mulDiv(this.stack[a]!, this.stack[a + 1]!, 64);
  }
  insABS(a: number): void {
    this.stack[a] = abs(this.stack[a]!);
  }
  insNEG(a: number): void {
    this.stack[a] = -this.stack[a]! | 0;
  }
  insFLOOR(a: number): void {
    this.stack[a] = pixFloor(this.stack[a]!);
  }
  insCEILING(a: number): void {
    this.stack[a] = pixCeil(this.stack[a]!);
  }

  insRS(a: number): void {
    const I = this.stack[a]! >>> 0;
    if (bounds(I, this.storeSize)) {
      if (this.pedanticHinting) {
        this.error = FtErr.Invalid_Reference;
        return;
      }
      this.stack[a] = 0;
    } else this.stack[a] = this.storage[I]!;
  }
  insWS(a: number): void {
    const I = this.stack[a]! >>> 0;
    if (bounds(I, this.storeSize)) {
      if (this.pedanticHinting) {
        this.error = FtErr.Invalid_Reference;
        return;
      }
    } else this.storage[I] = this.stack[a + 1]!;
  }
  insRCVT(a: number): void {
    const I = this.stack[a]! >>> 0;
    if (bounds(I, this.cvtSize)) {
      if (this.pedanticHinting) {
        this.error = FtErr.Invalid_Reference;
        return;
      }
      this.stack[a] = 0;
    } else this.stack[a] = this.readCvt(I);
  }
  insWCVTP(a: number): void {
    const I = this.stack[a]! >>> 0;
    if (bounds(I, this.cvtSize)) {
      if (this.pedanticHinting) {
        this.error = FtErr.Invalid_Reference;
        return;
      }
    } else this.writeCvt(I, this.stack[a + 1]!);
  }
  insWCVTF(a: number): void {
    const I = this.stack[a]! >>> 0;
    if (bounds(I, this.cvtSize)) {
      if (this.pedanticHinting) {
        this.error = FtErr.Invalid_Reference;
        return;
      }
    } else this.cvt[I] = mulFix(this.stack[a + 1]!, this.ttMetrics.scale);
  }
  insAA(_a: number): void {}
  insDEBUG(_a: number): void {
    this.error = FtErr.Debug_OpCode;
  }
  insROUND(a: number): void {
    this.stack[a] = this.round(this.stack[a]!, this.ttMetrics.compensations[this.opcode - 0x68]!);
  }
  insNROUND(a: number): void {
    this.stack[a] = this.roundNone(this.stack[a]!, this.ttMetrics.compensations[this.opcode - 0x6c]!);
  }
  insMAX(a: number): void {
    if (this.stack[a + 1]! > this.stack[a]!) this.stack[a] = this.stack[a + 1]!;
  }
  insMIN(a: number): void {
    if (this.stack[a + 1]! < this.stack[a]!) this.stack[a] = this.stack[a + 1]!;
  }

  insMINDEX(a: number): void {
    const s = this.stack;
    const L = s[a]!;
    if (L <= 0 || L > this.args) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
    } else {
      const K = s[this.args - L]!;
      s.copyWithin(this.args - L, this.args - L + 1, this.args - L + 1 + (L - 1));
      s[this.args - 1] = K;
    }
  }

  insROLL(a: number): void {
    const s = this.stack;
    const A = s[a + 2]!;
    const B = s[a + 1]!;
    const C = s[a]!;
    s[a + 2] = C;
    s[a + 1] = A;
    s[a] = B;
  }

  /** SkipCode: SUCCESS / FAILURE */
  skipCode(): number {
    this.IP = (this.IP + this.length) | 0;
    if (this.IP < this.codeSize) {
      this.opcode = this.code[this.IP]!;
      this.length = OPCODE_LENGTH[this.opcode]!;
      let overflow = false;
      if (this.length < 0) {
        if (this.IP + 1 >= this.codeSize) overflow = true;
        else this.length = (2 - Math.imul(this.length, this.code[this.IP + 1]!)) | 0;
      }
      if (!overflow && this.IP + this.length <= this.codeSize) return SUCCESS;
    }
    this.error = FtErr.Code_Overflow;
    return FAILURE;
  }

  insIF(a: number): void {
    if (this.stack[a]! !== 0) return;
    let nIfs = 1;
    let out = false;
    do {
      if (this.skipCode() === FAILURE) return;
      switch (this.opcode) {
        case 0x58:
          nIfs++;
          break;
        case 0x1b:
          out = nIfs === 1;
          break;
        case 0x59:
          nIfs--;
          out = nIfs === 0;
          break;
      }
    } while (!out);
  }

  insELSE(_a: number): void {
    let nIfs = 1;
    do {
      if (this.skipCode() === FAILURE) return;
      switch (this.opcode) {
        case 0x58:
          nIfs++;
          break;
        case 0x59:
          nIfs--;
          break;
      }
    } while (nIfs !== 0);
  }

  /** a DefRecord slot of FDefs / IDefs (the arrays are allocated zeroed, FT_NEW_ARRAY) */
  private defAt(arr: DefRecord[], i: number): DefRecord {
    let r = arr[i];
    if (!r) {
      for (let k = arr.length; k <= i; k++) arr.push({ range: 0, start: 0, end: 0, opc: 0, active: false, inlineDelta: false });
      r = arr[i]!;
    }
    return r;
  }

  insFDEF(a: number): void {
    const n = this.stack[a]! >>> 0;
    let idx = 0;
    for (; idx < this.numFDefs; idx++) if (this.defAt(this.FDefs, idx).opc === n) break;
    if (idx === this.numFDefs) {
      if (this.numFDefs >= this.maxFDefs) {
        this.error = FtErr.Too_Many_Function_Defs;
        return;
      }
      this.numFDefs++;
    }
    if (n > 0xffff) {
      this.error = FtErr.Too_Many_Function_Defs;
      return;
    }
    const rec = this.defAt(this.FDefs, idx);
    rec.range = this.curRange;
    rec.opc = n & 0xffff;
    rec.start = (this.IP + 1) | 0;
    rec.active = true;
    rec.inlineDelta = false;
    if (n > this.maxFunc) this.maxFunc = n & 0xffff;
    while (this.skipCode() === SUCCESS) {
      switch (this.opcode) {
        case 0x89:
        case 0x2c:
          this.error = FtErr.Nested_DEFS;
          return;
        case 0x2d:
          rec.end = this.IP;
          return;
      }
    }
  }

  insENDF(_a: number): void {
    if (this.callTop <= 0) {
      this.error = FtErr.ENDF_In_Exec_Stream;
      return;
    }
    this.callTop--;
    const pRec = this.callStack[this.callTop]!;
    pRec.curCount--;
    this.stepIns = false;
    if (pRec.curCount > 0) {
      this.callTop++;
      this.IP = pRec.curRestart;
    } else this.insGotoCodeRange(pRec.callerRange, pRec.callerIP);
  }

  /** the search shared by CALL and LOOPCALL: the definition of function F, or null after setting error */
  private findFunction(F: number): DefRecord | null {
    if (bounds(F, (this.maxFunc + 1) | 0)) {
      this.error = FtErr.Invalid_Reference;
      return null;
    }
    let def: DefRecord | undefined = this.defAt(this.FDefs, F);
    if (((this.maxFunc + 1) | 0) !== this.numFDefs || def.opc !== F) {
      def = undefined;
      for (let i = 0; i < this.numFDefs; i++) {
        const d = this.defAt(this.FDefs, i);
        if (d.opc === F) {
          def = d;
          break;
        }
      }
      if (!def) {
        this.error = FtErr.Invalid_Reference;
        return null;
      }
    }
    if (!def.active) {
      this.error = FtErr.Invalid_Reference;
      return null;
    }
    return def;
  }

  insCALL(a: number): void {
    const F = this.stack[a]! >>> 0;
    const def = this.findFunction(F);
    if (!def) return;
    if (this.callTop >= this.callSize) {
      this.error = FtErr.Stack_Overflow;
      return;
    }
    const c = this.callStack[this.callTop]!;
    c.callerRange = this.curRange;
    c.callerIP = (this.IP + 1) | 0;
    c.curCount = 1;
    c.curRestart = def.start;
    c.curEnd = def.end;
    this.callTop++;
    this.insGotoCodeRange(def.range, def.start);
    this.stepIns = false;
  }

  insLOOPCALL(a: number): void {
    const F = this.stack[a + 1]! >>> 0;
    const def = this.findFunction(F);
    if (!def) return;
    if (this.callTop >= this.callSize) {
      this.error = FtErr.Stack_Overflow;
      return;
    }
    if (this.stack[a]! > 0) {
      const c = this.callStack[this.callTop]!;
      c.callerRange = this.curRange;
      c.callerIP = (this.IP + 1) | 0;
      c.curCount = this.stack[a]!;
      c.curRestart = def.start;
      c.curEnd = def.end;
      this.callTop++;
      this.insGotoCodeRange(def.range, def.start);
      this.stepIns = false;
    }
  }

  insIDEF(a: number): void {
    const opc = this.stack[a]!;
    let idx = 0;
    for (; idx < this.numIDefs; idx++) if (this.defAt(this.IDefs, idx).opc === opc >>> 0) break;
    if (idx === this.numIDefs) {
      if (this.numIDefs >= this.maxIDefs) {
        this.error = FtErr.Too_Many_Instruction_Defs;
        return;
      }
      this.numIDefs++;
    }
    if (opc < 0 || opc > 0xff) {
      this.error = FtErr.Too_Many_Instruction_Defs;
      return;
    }
    const def = this.defAt(this.IDefs, idx);
    def.opc = opc & 0xff;
    def.start = (this.IP + 1) | 0;
    def.range = this.curRange;
    def.active = true;
    if (opc >>> 0 > this.maxIns) this.maxIns = opc & 0xff;
    while (this.skipCode() === SUCCESS) {
      switch (this.opcode) {
        case 0x89:
        case 0x2c:
          this.error = FtErr.Nested_DEFS;
          return;
        case 0x2d:
          return;
      }
    }
  }

  insNPUSHB(a: number): void {
    const L = this.code[this.IP + 1]!;
    if (bounds(L, (this.stackSize + 1 - this.top) | 0)) {
      this.error = FtErr.Stack_Overflow;
      return;
    }
    for (let K = 1; K <= L; K++) this.stack[a + K - 1] = this.code[this.IP + K + 1]!;
    this.newTop += L;
  }

  insNPUSHW(a: number): void {
    const L = this.code[this.IP + 1]!;
    if (bounds(L, (this.stackSize + 1 - this.top) | 0)) {
      this.error = FtErr.Stack_Overflow;
      return;
    }
    this.IP += 2;
    for (let K = 0; K < L; K++) this.stack[a + K] = this.getShortIns();
    this.stepIns = false;
    this.newTop += L;
  }

  insPUSHB(a: number): void {
    const L = this.opcode - 0xb0 + 1;
    if (bounds(L, (this.stackSize + 1 - this.top) | 0)) {
      this.error = FtErr.Stack_Overflow;
      return;
    }
    for (let K = 1; K <= L; K++) this.stack[a + K - 1] = this.code[this.IP + K]!;
  }

  insPUSHW(a: number): void {
    const L = this.opcode - 0xb8 + 1;
    if (bounds(L, (this.stackSize + 1 - this.top) | 0)) {
      this.error = FtErr.Stack_Overflow;
      return;
    }
    this.IP++;
    for (let K = 0; K < L; K++) this.stack[a + K] = this.getShortIns();
    this.stepIns = false;
  }

  insGC(a: number): void {
    const L = this.stack[a]! >>> 0;
    let R: number;
    if (bounds(L, this.zp2.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      R = 0;
    } else if (this.opcode & 1) R = this.dualProject(this.zp2.org[2 * L]!, this.zp2.org[2 * L + 1]!);
    else R = this.project(this.zp2.cur[2 * L]!, this.zp2.cur[2 * L + 1]!);
    this.stack[a] = R;
  }

  insSCFS(a: number): void {
    const L = this.stack[a]! & 0xffff;
    if (bounds(L, this.zp2.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    const K = this.project(this.zp2.cur[2 * L]!, this.zp2.cur[2 * L + 1]!);
    this.move(this.zp2, L, (this.stack[a + 1]! - K) | 0);
    if (this.GS.gep2 === 0) {
      this.zp2.org[2 * L] = this.zp2.cur[2 * L]!;
      this.zp2.org[2 * L + 1] = this.zp2.cur[2 * L + 1]!;
    }
  }

  insMD(a: number): void {
    const K = this.stack[a + 1]! & 0xffff;
    const L = this.stack[a]! & 0xffff;
    let D: number;
    if (bounds(L, this.zp0.nPoints) || bounds(K, this.zp1.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      D = 0;
    } else if (this.opcode & 1) D = this.projectPts(this.zp0.cur, L, this.zp1.cur, K);
    else if (this.GS.gep0 === 0 || this.GS.gep1 === 0) D = this.dualProjectPts(this.zp0.org, L, this.zp1.org, K);
    else {
      const v1 = this.zp0.orus;
      const v2 = this.zp1.orus;
      if (this.metrics.xScale === this.metrics.yScale) {
        D = this.dualProjectPts(v1, L, v2, K);
        D = mulFix(D, this.metrics.xScale);
      } else {
        const vx = mulFix((v1[2 * L]! - v2[2 * K]!) | 0, this.metrics.xScale);
        const vy = mulFix((v1[2 * L + 1]! - v2[2 * K + 1]!) | 0, this.metrics.yScale);
        D = this.dualProject(vx, vy);
      }
    }
    this.stack[a] = D;
  }

  insSDPVTL(a: number): void {
    let aOpc = this.opcode;
    const p1 = this.stack[a + 1]! & 0xffff;
    const p2 = this.stack[a]! & 0xffff;
    if (bounds(p2, this.zp1.nPoints) || bounds(p1, this.zp2.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    let A = (this.zp1.org[2 * p2]! - this.zp2.org[2 * p1]!) | 0;
    let B = (this.zp1.org[2 * p2 + 1]! - this.zp2.org[2 * p1 + 1]!) | 0;
    if (A === 0 && B === 0) {
      A = 0x4000;
      aOpc = 0;
    }
    let C: number;
    if ((aOpc & 1) !== 0) {
      C = B;
      B = A;
      A = -C | 0;
    }
    this.normalize(A, B, this.GS.dualVector);
    A = (this.zp1.cur[2 * p2]! - this.zp2.cur[2 * p1]!) | 0;
    B = (this.zp1.cur[2 * p2 + 1]! - this.zp2.cur[2 * p1 + 1]!) | 0;
    if ((aOpc & 1) !== 0) {
      C = B;
      B = A;
      A = -C | 0;
    }
    this.normalize(A, B, this.GS.projVector);
    this.computeFuncs();
  }

  insSZP0(a: number): void {
    switch (this.stack[a]!) {
      case 0:
        this.zp0.assign(this.twilight);
        break;
      case 1:
        this.zp0.assign(this.pts);
        break;
      default:
        if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
        return;
    }
    this.GS.gep0 = this.stack[a]! & 0xffff;
  }
  insSZP1(a: number): void {
    switch (this.stack[a]!) {
      case 0:
        this.zp1.assign(this.twilight);
        break;
      case 1:
        this.zp1.assign(this.pts);
        break;
      default:
        if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
        return;
    }
    this.GS.gep1 = this.stack[a]! & 0xffff;
  }
  insSZP2(a: number): void {
    switch (this.stack[a]!) {
      case 0:
        this.zp2.assign(this.twilight);
        break;
      case 1:
        this.zp2.assign(this.pts);
        break;
      default:
        if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
        return;
    }
    this.GS.gep2 = this.stack[a]! & 0xffff;
  }
  insSZPS(a: number): void {
    switch (this.stack[a]!) {
      case 0:
        this.zp0.assign(this.twilight);
        break;
      case 1:
        this.zp0.assign(this.pts);
        break;
      default:
        if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
        return;
    }
    this.zp1.assign(this.zp0);
    this.zp2.assign(this.zp0);
    this.GS.gep0 = this.stack[a]! & 0xffff;
    this.GS.gep1 = this.stack[a]! & 0xffff;
    this.GS.gep2 = this.stack[a]! & 0xffff;
  }

  insINSTCTRL(a: number): void {
    const K = this.stack[a + 1]!;
    let L = this.stack[a]!;
    if (K < 1 || K > 2) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    if (L !== 0) L = K;
    // FT_BOOL( x ) is only a cast to FT_Bool (unsigned char), so the result is a byte, not 0 / 1
    this.GS.instructControl = ((this.GS.instructControl & 0xff & ~(K & 0xff)) | (L & 0xff)) & 0xff;
  }

  insSCANCTRL(a: number): void {
    const v = this.stack[a]!;
    const A = v & 0xff;
    if (A === 0xff) {
      this.GS.scanControl = true;
      return;
    } else if (A === 0) {
      this.GS.scanControl = false;
      return;
    }
    if ((v & 0x100) !== 0 && this.ttMetrics.ppem <= A) this.GS.scanControl = true;
    if ((v & 0x200) !== 0 && this.ttMetrics.rotated) this.GS.scanControl = true;
    if ((v & 0x400) !== 0 && this.ttMetrics.stretched) this.GS.scanControl = true;
    if ((v & 0x800) !== 0 && this.ttMetrics.ppem > A) this.GS.scanControl = false;
    if ((v & 0x1000) !== 0 && this.ttMetrics.rotated) this.GS.scanControl = false;
    if ((v & 0x2000) !== 0 && this.ttMetrics.stretched) this.GS.scanControl = false;
  }

  insSCANTYPE(a: number): void {
    if (this.stack[a]! >= 0) this.GS.scanType = this.stack[a]!;
  }

  insFLIPPT(_a: number): void {
    if (this.top < this.GS.loop) {
      if (this.pedanticHinting) this.error = FtErr.Too_Few_Arguments;
    } else {
      while (this.GS.loop > 0) {
        this.args--;
        const point = this.stack[this.args]! & 0xffff;
        if (bounds(point, this.pts.nPoints)) {
          if (this.pedanticHinting) {
            this.error = FtErr.Invalid_Reference;
            return;
          }
        } else this.pts.tags[point]! ^= TAG_ON;
        this.GS.loop--;
      }
    }
    this.GS.loop = 1;
    this.newTop = this.args;
  }

  insFLIPRGON(a: number): void {
    const K = this.stack[a + 1]! & 0xffff;
    const L = this.stack[a]! & 0xffff;
    if (bounds(K, this.pts.nPoints) || bounds(L, this.pts.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    for (let I = L; I <= K; I++) this.pts.tags[I]! |= TAG_ON;
  }

  insFLIPRGOFF(a: number): void {
    const K = this.stack[a + 1]! & 0xffff;
    const L = this.stack[a]! & 0xffff;
    if (bounds(K, this.pts.nPoints) || bounds(L, this.pts.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    for (let I = L; I <= K; I++) this.pts.tags[I]! &= ~TAG_ON;
  }

  // Compute_Point_Displacement's outputs
  private dispX = 0;
  private dispY = 0;
  private dispZone = new GlyphZone();
  private dispRef = 0;

  /** Compute_Point_Displacement: SUCCESS / FAILURE; the results are in dispX / dispY / dispZone / dispRef */
  private computePointDisplacement(): number {
    let zp: GlyphZone;
    let p: number;
    if (this.opcode & 1) {
      zp = this.zp0;
      p = this.GS.rp1;
    } else {
      zp = this.zp1;
      p = this.GS.rp2;
    }
    if (bounds(p, zp.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      this.dispRef = 0;
      return FAILURE;
    }
    this.dispZone.assign(zp);
    this.dispRef = p;
    const d = this.projectPts(zp.cur, p, zp.org, p);
    this.dispX = mulDiv(d, this.GS.freeVector.x, this.FdotP);
    this.dispY = mulDiv(d, this.GS.freeVector.y, this.FdotP);
    return SUCCESS;
  }

  /** Move_Zp2_Point */
  private moveZp2Point(point: number, dx: number, dy: number, touch: boolean): void {
    const z = this.zp2;
    if (this.GS.freeVector.x !== 0) {
      z.cur[2 * point] = (z.cur[2 * point]! + dx) | 0;
      if (touch) z.tags[point]! |= TOUCH_X;
    }
    if (this.GS.freeVector.y !== 0) {
      z.cur[2 * point + 1] = (z.cur[2 * point + 1]! + dy) | 0;
      if (touch) z.tags[point]! |= TOUCH_Y;
    }
  }

  insSHP(_a: number): void {
    if (this.top < this.GS.loop) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
    } else {
      if (this.computePointDisplacement()) return;
      const dx = this.dispX;
      const dy = this.dispY;
      while (this.GS.loop > 0) {
        this.args--;
        const point = this.stack[this.args]! & 0xffff;
        if (bounds(point, this.zp2.nPoints)) {
          if (this.pedanticHinting) {
            this.error = FtErr.Invalid_Reference;
            return;
          }
        } else this.moveZp2Point(point, dx, dy, true);
        this.GS.loop--;
      }
    }
    this.GS.loop = 1;
    this.newTop = this.args;
  }

  insSHC(a: number): void {
    const contour = int16(this.stack[a]!);
    const bnd = this.GS.gep2 === 0 ? 1 : int16(this.zp2.nContours);
    if (bounds(contour, bnd)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    if (this.computePointDisplacement()) return;
    const dx = this.dispX;
    const dy = this.dispY;
    const zpCur = this.dispZone.cur;
    const refp = this.dispRef;
    const start = contour === 0 ? 0 : (this.zp2.contours[contour - 1]! + 1 - this.zp2.firstPoint) & 0xffff;
    const limit = this.GS.gep2 === 0 ? this.zp2.nPoints : (this.zp2.contours[contour]! - this.zp2.firstPoint + 1) & 0xffff;
    for (let i = start; i < limit; i++) {
      if (zpCur !== this.zp2.cur || refp !== i) this.moveZp2Point(i, dx, dy, true);
    }
  }

  insSHZ(a: number): void {
    if (bounds(this.stack[a]!, 2)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    if (this.computePointDisplacement()) return;
    const dx = this.dispX;
    const dy = this.dispY;
    const zpCur = this.dispZone.cur;
    const refp = this.dispRef;
    let limit: number;
    if (this.GS.gep2 === 0) limit = this.zp2.nPoints & 0xffff;
    else if (this.GS.gep2 === 1 && this.zp2.nContours > 0) limit = (this.zp2.contours[this.zp2.nContours - 1]! + 1) & 0xffff;
    else limit = 0;
    for (let i = 0; i < limit; i++) {
      if (zpCur !== this.zp2.cur || refp !== i) this.moveZp2Point(i, dx, dy, false);
    }
  }

  insSHPIX(a: number): void {
    if (this.top < this.GS.loop + 1) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
    } else {
      const dx = ttMulFix14(this.stack[a]!, this.GS.freeVector.x);
      const dy = ttMulFix14(this.stack[a]!, this.GS.freeVector.y);
      while (this.GS.loop > 0) {
        this.args--;
        const point = this.stack[this.args]! & 0xffff;
        if (bounds(point, this.zp2.nPoints)) {
          if (this.pedanticHinting) {
            this.error = FtErr.Invalid_Reference;
            return;
          }
        } else this.moveZp2Point(point, dx, dy, true);
        this.GS.loop--;
      }
    }
    this.GS.loop = 1;
    this.newTop = this.args;
  }

  insMSIRP(a: number): void {
    const point = this.stack[a]! & 0xffff;
    if (bounds(point, this.zp1.nPoints) || bounds(this.GS.rp0, this.zp0.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    const rp0 = this.GS.rp0;
    if (this.GS.gep1 === 0) {
      this.zp1.org[2 * point] = this.zp0.org[2 * rp0]!;
      this.zp1.org[2 * point + 1] = this.zp0.org[2 * rp0 + 1]!;
      this.moveOrig(this.zp1, point, this.stack[a + 1]!);
      this.zp1.cur[2 * point] = this.zp1.org[2 * point]!;
      this.zp1.cur[2 * point + 1] = this.zp1.org[2 * point + 1]!;
    }
    const distance = this.projectPts(this.zp1.cur, point, this.zp0.cur, rp0);
    this.move(this.zp1, point, (this.stack[a + 1]! - distance) | 0);
    this.GS.rp1 = this.GS.rp0;
    this.GS.rp2 = point;
    if ((this.opcode & 1) !== 0) this.GS.rp0 = point;
  }

  insMDAP(a: number): void {
    const point = this.stack[a]! & 0xffff;
    if (bounds(point, this.zp0.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    let distance: number;
    if ((this.opcode & 1) !== 0) {
      const curDist = this.project(this.zp0.cur[2 * point]!, this.zp0.cur[2 * point + 1]!);
      distance = (this.round(curDist, this.ttMetrics.compensations[0]!) - curDist) | 0;
    } else distance = 0;
    this.move(this.zp0, point, distance);
    this.GS.rp0 = point;
    this.GS.rp1 = point;
  }

  insMIAP(a: number): void {
    const controlValueCutin = this.GS.controlValueCutin;
    const cvtEntry = this.stack[a + 1]! >>> 0;
    const point = this.stack[a]! & 0xffff;
    if (bounds(point, this.zp0.nPoints) || bounds(cvtEntry, this.cvtSize)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
    } else {
      let distance = this.readCvt(cvtEntry);
      if (this.GS.gep0 === 0) {
        this.zp0.org[2 * point] = ttMulFix14(distance, this.GS.freeVector.x);
        this.zp0.org[2 * point + 1] = ttMulFix14(distance, this.GS.freeVector.y);
        this.zp0.cur[2 * point] = this.zp0.org[2 * point]!;
        this.zp0.cur[2 * point + 1] = this.zp0.org[2 * point + 1]!;
      }
      const orgDist = this.project(this.zp0.cur[2 * point]!, this.zp0.cur[2 * point + 1]!);
      if ((this.opcode & 1) !== 0) {
        if (abs((distance - orgDist) | 0) > controlValueCutin) distance = orgDist;
        distance = this.round(distance, this.ttMetrics.compensations[0]!);
      }
      this.move(this.zp0, point, (distance - orgDist) | 0);
    }
    this.GS.rp0 = point;
    this.GS.rp1 = point;
  }

  insMDRP(a: number): void {
    const minimumDistance = this.GS.minimumDistance;
    const point = this.stack[a]! & 0xffff;
    if (bounds(point, this.zp1.nPoints) || bounds(this.GS.rp0, this.zp0.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
    } else {
      const rp0 = this.GS.rp0;
      let orgDist: number;
      if (this.GS.gep0 === 0 || this.GS.gep1 === 0) orgDist = this.dualProjectPts(this.zp1.org, point, this.zp0.org, rp0);
      else {
        const v1 = this.zp1.orus;
        const v2 = this.zp0.orus;
        if (this.metrics.xScale === this.metrics.yScale) {
          orgDist = this.dualProjectPts(v1, point, v2, rp0);
          orgDist = mulFix(orgDist, this.metrics.xScale);
        } else {
          const vx = mulFix((v1[2 * point]! - v2[2 * rp0]!) | 0, this.metrics.xScale);
          const vy = mulFix((v1[2 * point + 1]! - v2[2 * rp0 + 1]!) | 0, this.metrics.yScale);
          orgDist = this.dualProject(vx, vy);
        }
      }
      if (abs((orgDist - this.GS.singleWidthValue) | 0) < this.GS.singleWidthCutin) {
        if (orgDist >= 0) orgDist = this.GS.singleWidthValue;
        else orgDist = -this.GS.singleWidthValue | 0;
      }
      let distance: number;
      if ((this.opcode & 4) !== 0) distance = this.round(orgDist, this.ttMetrics.compensations[this.opcode & 3]!);
      else distance = this.roundNone(orgDist, this.ttMetrics.compensations[this.opcode & 3]!);
      if ((this.opcode & 8) !== 0) {
        if (orgDist >= 0) {
          if (distance < minimumDistance) distance = minimumDistance;
        } else if (distance > -minimumDistance) distance = -minimumDistance | 0;
      }
      orgDist = this.projectPts(this.zp1.cur, point, this.zp0.cur, rp0);
      this.move(this.zp1, point, (distance - orgDist) | 0);
    }
    this.GS.rp1 = this.GS.rp0;
    this.GS.rp2 = point;
    if ((this.opcode & 16) !== 0) this.GS.rp0 = point;
  }

  insMIRP(a: number): void {
    const minimumDistance = this.GS.minimumDistance;
    const controlValueCutin = this.GS.controlValueCutin;
    const point = this.stack[a]! & 0xffff;
    const cvtEntry = (this.stack[a + 1]! + 1) >>> 0;
    if (bounds(point, this.zp1.nPoints) || bounds(cvtEntry, (this.cvtSize + 1) | 0) || bounds(this.GS.rp0, this.zp0.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
    } else {
      const rp0 = this.GS.rp0;
      let cvtDist: number;
      if (!cvtEntry) cvtDist = 0;
      else cvtDist = this.readCvt(cvtEntry - 1);
      if (abs((cvtDist - this.GS.singleWidthValue) | 0) < this.GS.singleWidthCutin) {
        if (cvtDist >= 0) cvtDist = this.GS.singleWidthValue;
        else cvtDist = -this.GS.singleWidthValue | 0;
      }
      if (this.GS.gep1 === 0) {
        this.zp1.org[2 * point] = (this.zp0.org[2 * rp0]! + ttMulFix14(cvtDist, this.GS.freeVector.x)) | 0;
        this.zp1.org[2 * point + 1] = (this.zp0.org[2 * rp0 + 1]! + ttMulFix14(cvtDist, this.GS.freeVector.y)) | 0;
        this.zp1.cur[2 * point] = this.zp1.org[2 * point]!;
        this.zp1.cur[2 * point + 1] = this.zp1.org[2 * point + 1]!;
      }
      const orgDist = this.dualProjectPts(this.zp1.org, point, this.zp0.org, rp0);
      const curDist = this.projectPts(this.zp1.cur, point, this.zp0.cur, rp0);
      if (this.GS.autoFlip) {
        if ((orgDist ^ cvtDist) < 0) cvtDist = -cvtDist | 0;
      }
      let distance: number;
      if ((this.opcode & 4) !== 0) {
        if (this.GS.gep0 === this.GS.gep1) {
          if (abs((cvtDist - orgDist) | 0) > controlValueCutin) cvtDist = orgDist;
        }
        distance = this.round(cvtDist, this.ttMetrics.compensations[this.opcode & 3]!);
      } else distance = this.roundNone(cvtDist, this.ttMetrics.compensations[this.opcode & 3]!);
      if ((this.opcode & 8) !== 0) {
        if (orgDist >= 0) {
          if (distance < minimumDistance) distance = minimumDistance;
        } else if (distance > -minimumDistance) distance = -minimumDistance | 0;
      }
      this.move(this.zp1, point, (distance - curDist) | 0);
    }
    this.GS.rp1 = this.GS.rp0;
    if ((this.opcode & 16) !== 0) this.GS.rp0 = point;
    this.GS.rp2 = point;
  }

  insALIGNRP(_a: number): void {
    if (this.top < this.GS.loop || bounds(this.GS.rp0, this.zp0.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
    } else {
      while (this.GS.loop > 0) {
        this.args--;
        const point = this.stack[this.args]! & 0xffff;
        if (bounds(point, this.zp1.nPoints)) {
          if (this.pedanticHinting) {
            this.error = FtErr.Invalid_Reference;
            return;
          }
        } else {
          const distance = this.projectPts(this.zp1.cur, point, this.zp0.cur, this.GS.rp0);
          this.move(this.zp1, point, -distance | 0);
        }
        this.GS.loop--;
      }
    }
    this.GS.loop = 1;
    this.newTop = this.args;
  }

  insISECT(a: number): void {
    const s = this.stack;
    const point = s[a]! & 0xffff;
    const a0 = s[a + 1]! & 0xffff;
    const a1 = s[a + 2]! & 0xffff;
    const b0 = s[a + 3]! & 0xffff;
    const b1 = s[a + 4]! & 0xffff;
    if (
      bounds(b0, this.zp0.nPoints) ||
      bounds(b1, this.zp0.nPoints) ||
      bounds(a0, this.zp1.nPoints) ||
      bounds(a1, this.zp1.nPoints) ||
      bounds(point, this.zp2.nPoints)
    ) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    const z0 = this.zp0.cur;
    const z1 = this.zp1.cur;
    const z2 = this.zp2.cur;
    const dbx = (z0[2 * b1]! - z0[2 * b0]!) | 0;
    const dby = (z0[2 * b1 + 1]! - z0[2 * b0 + 1]!) | 0;
    const dax = (z1[2 * a1]! - z1[2 * a0]!) | 0;
    const day = (z1[2 * a1 + 1]! - z1[2 * a0 + 1]!) | 0;
    const dx = (z0[2 * b0]! - z1[2 * a0]!) | 0;
    const dy = (z0[2 * b0 + 1]! - z1[2 * a0 + 1]!) | 0;
    this.zp2.tags[point]! |= TOUCH_BOTH;
    const discriminant = (mulDiv(dax, -dby | 0, 0x40) + mulDiv(day, dbx, 0x40)) | 0;
    const dotproduct = (mulDiv(dax, dbx, 0x40) + mulDiv(day, dby, 0x40)) | 0;
    if (Math.imul(19, abs(discriminant)) > abs(dotproduct)) {
      const val = (mulDiv(dx, -dby | 0, 0x40) + mulDiv(dy, dbx, 0x40)) | 0;
      const rx = mulDiv(val, dax, discriminant);
      const ry = mulDiv(val, day, discriminant);
      z2[2 * point] = (z1[2 * a0]! + rx) | 0;
      z2[2 * point + 1] = (z1[2 * a0 + 1]! + ry) | 0;
    } else {
      z2[2 * point] = idiv((z1[2 * a0]! + z1[2 * a1]! + z0[2 * b0]! + z0[2 * b1]!) | 0, 4);
      z2[2 * point + 1] = idiv((z1[2 * a0 + 1]! + z1[2 * a1 + 1]! + z0[2 * b0 + 1]! + z0[2 * b1 + 1]!) | 0, 4);
    }
  }

  insALIGNPTS(a: number): void {
    const p1 = this.stack[a]! & 0xffff;
    const p2 = this.stack[a + 1]! & 0xffff;
    if (bounds(p1, this.zp1.nPoints) || bounds(p2, this.zp0.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    const distance = idiv(this.projectPts(this.zp0.cur, p2, this.zp1.cur, p1), 2);
    this.move(this.zp1, p1, distance);
    this.move(this.zp0, p2, -distance | 0);
  }

  insIP(_a: number): void {
    if (this.top < this.GS.loop) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
    } else {
      const twilight = this.GS.gep0 === 0 || this.GS.gep1 === 0 || this.GS.gep2 === 0;
      const rp1 = this.GS.rp1;
      const rp2 = this.GS.rp2;
      if (bounds(rp1, this.zp0.nPoints)) {
        if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      } else {
        // orus_base points into zp0.org (twilight) or zp0.orus; cur_base into zp0.cur -- both are read where the C reads through the pointer
        const orusBase = twilight ? this.zp0.org : this.zp0.orus;
        const curBase = this.zp0.cur;
        let oldRange: number;
        let curRange: number;
        if (bounds(rp1, this.zp0.nPoints) || bounds(rp2, this.zp1.nPoints)) {
          oldRange = 0;
          curRange = 0;
        } else {
          if (twilight) oldRange = this.dualProjectPts(this.zp1.org, rp2, orusBase, rp1);
          else if (this.metrics.xScale === this.metrics.yScale) oldRange = this.dualProjectPts(this.zp1.orus, rp2, orusBase, rp1);
          else {
            const vx = mulFix((this.zp1.orus[2 * rp2]! - orusBase[2 * rp1]!) | 0, this.metrics.xScale);
            const vy = mulFix((this.zp1.orus[2 * rp2 + 1]! - orusBase[2 * rp1 + 1]!) | 0, this.metrics.yScale);
            oldRange = this.dualProject(vx, vy);
          }
          curRange = this.projectPts(this.zp1.cur, rp2, curBase, rp1);
        }
        for (; this.GS.loop > 0; --this.GS.loop) {
          const point = this.stack[--this.args]! >>> 0;
          if (bounds(point, this.zp2.nPoints)) {
            if (this.pedanticHinting) {
              this.error = FtErr.Invalid_Reference;
              return;
            }
            continue;
          }
          let orgDist: number;
          if (twilight) orgDist = this.dualProjectPts(this.zp2.org, point, orusBase, rp1);
          else if (this.metrics.xScale === this.metrics.yScale) orgDist = this.dualProjectPts(this.zp2.orus, point, orusBase, rp1);
          else {
            const vx = mulFix((this.zp2.orus[2 * point]! - orusBase[2 * rp1]!) | 0, this.metrics.xScale);
            const vy = mulFix((this.zp2.orus[2 * point + 1]! - orusBase[2 * rp1 + 1]!) | 0, this.metrics.yScale);
            orgDist = this.dualProject(vx, vy);
          }
          const curDist = this.projectPts(this.zp2.cur, point, curBase, rp1);
          let newDist: number;
          if (orgDist) newDist = oldRange !== 0 ? mulDiv(orgDist, curRange, oldRange) : curDist;
          else newDist = 0;
          this.move(this.zp2, point & 0xffff, (newDist - curDist) | 0);
        }
      }
    }
    this.GS.loop = 1;
    this.newTop = this.args;
  }

  insUTP(a: number): void {
    const point = this.stack[a]! & 0xffff;
    if (bounds(point, this.zp0.nPoints)) {
      if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
      return;
    }
    let mask = 0xff;
    if (this.GS.freeVector.x !== 0) mask &= ~TOUCH_X;
    if (this.GS.freeVector.y !== 0) mask &= ~TOUCH_Y;
    this.zp0.tags[point]! &= mask;
  }

  /** _iup_worker_shift on the x (off = 0) or y (off = 1) coordinates */
  private iupShift(orgs: Int32Array, curs: Int32Array, off: number, p1: number, p2: number, p: number): void {
    const dx = (curs[2 * p + off]! - orgs[2 * p + off]!) | 0;
    if (dx !== 0) {
      for (let i = p1; i < p; i++) curs[2 * i + off] = (curs[2 * i + off]! + dx) | 0;
      for (let i = p + 1; i <= p2; i++) curs[2 * i + off] = (curs[2 * i + off]! + dx) | 0;
    }
  }

  /** _iup_worker_interpolate */
  private iupInterpolate(orgs: Int32Array, curs: Int32Array, orus: Int32Array, off: number, maxPoints: number, p1: number, p2: number, ref1: number, ref2: number): void {
    if (p1 > p2) return;
    if (bounds(ref1, maxPoints) || bounds(ref2, maxPoints)) return;
    let orus1 = orus[2 * ref1 + off]!;
    let orus2 = orus[2 * ref2 + off]!;
    if (orus1 > orus2) {
      const tmpO = orus1;
      orus1 = orus2;
      orus2 = tmpO;
      const tmpR = ref1;
      ref1 = ref2;
      ref2 = tmpR;
    }
    const org1 = orgs[2 * ref1 + off]!;
    const org2 = orgs[2 * ref2 + off]!;
    const delta1 = (curs[2 * ref1 + off]! - org1) | 0;
    const delta2 = (curs[2 * ref2 + off]! - org2) | 0;
    if (orus1 === orus2) {
      for (let i = p1; i <= p2; i++) {
        let x = orgs[2 * i + off]!;
        if (x <= org1) x = (x + delta1) | 0;
        else x = (x + delta2) | 0;
        curs[2 * i + off] = x;
      }
    } else {
      let scale = 0;
      let scaleValid = false;
      for (let i = p1; i <= p2; i++) {
        let x = orgs[2 * i + off]!;
        if (x <= org1) x = (x + delta1) | 0;
        else if (x >= org2) x = (x + delta2) | 0;
        else {
          if (!scaleValid) {
            scaleValid = true;
            scale = divFix((org2 + delta2 - (org1 + delta1)) | 0, (orus2 - orus1) | 0);
          }
          x = (org1 + delta1 + mulFix((orus[2 * i + off]! - orus1) | 0, scale)) | 0;
        }
        curs[2 * i + off] = x;
      }
    }
  }

  insIUP(_a: number): void {
    const pts = this.pts;
    if (pts.nContours === 0) return;
    let mask: number;
    let off: number;
    if (this.opcode & 1) {
      mask = TOUCH_X;
      off = 0;
    } else {
      mask = TOUCH_Y;
      off = 1;
    }
    const orgs = pts.org;
    const curs = pts.cur;
    const orus = pts.orus;
    const maxPoints = pts.nPoints;
    let contour = 0;
    let point = 0;
    do {
      let endPoint = (pts.contours[contour]! - pts.firstPoint) >>> 0;
      const firstPoint = point;
      if (bounds(endPoint, pts.nPoints)) endPoint = (pts.nPoints - 1) >>> 0;
      while (point <= endPoint && (pts.tags[point]! & mask) === 0) point++;
      if (point <= endPoint) {
        const firstTouched = point;
        let curTouched = point;
        point++;
        while (point <= endPoint) {
          if ((pts.tags[point]! & mask) !== 0) {
            this.iupInterpolate(orgs, curs, orus, off, maxPoints, curTouched + 1, point - 1, curTouched, point);
            curTouched = point;
          }
          point++;
        }
        if (curTouched === firstTouched) this.iupShift(orgs, curs, off, firstPoint, endPoint, curTouched);
        else {
          this.iupInterpolate(orgs, curs, orus, off, maxPoints, (curTouched + 1) & 0xffff, endPoint, curTouched, firstTouched);
          if (firstTouched > 0) this.iupInterpolate(orgs, curs, orus, off, maxPoints, firstPoint, firstTouched - 1, curTouched, firstTouched);
        }
      }
      contour++;
    } while (contour < pts.nContours);
  }

  insDELTAP(a: number): void {
    const nump = this.stack[a]! >>> 0;
    for (let k = 1; k <= nump; k++) {
      if (this.args < 2) {
        if (this.pedanticHinting) this.error = FtErr.Too_Few_Arguments;
        this.args = 0;
        this.newTop = this.args;
        return;
      }
      this.args -= 2;
      const A = this.stack[this.args + 1]! & 0xffff;
      let B = this.stack[this.args]!;
      if (!bounds(A, this.zp0.nPoints)) {
        let C = ((B >>> 0) & 0xf0) >>> 4;
        switch (this.opcode) {
          case 0x5d:
            break;
          case 0x71:
            C += 16;
            break;
          case 0x72:
            C += 32;
            break;
        }
        C = (C + this.GS.deltaBase) | 0;
        if (this.currentPpem() === C) {
          B = (((B >>> 0) & 0xf) - 8) | 0;
          if (B >= 0) B++;
          B = idiv(Math.imul(B, 64), 1 << this.GS.deltaShift);
          this.move(this.zp0, A, B);
        }
      } else if (this.pedanticHinting) this.error = FtErr.Invalid_Reference;
    }
    this.newTop = this.args;
  }

  insDELTAC(a: number): void {
    const nump = this.stack[a]! >>> 0;
    for (let k = 1; k <= nump; k++) {
      if (this.args < 2) {
        if (this.pedanticHinting) this.error = FtErr.Too_Few_Arguments;
        this.args = 0;
        this.newTop = this.args;
        return;
      }
      this.args -= 2;
      const A = this.stack[this.args + 1]! >>> 0;
      let B = this.stack[this.args]!;
      if (bounds(A, this.cvtSize)) {
        if (this.pedanticHinting) {
          this.error = FtErr.Invalid_Reference;
          return;
        }
      } else {
        let C = ((B >>> 0) & 0xf0) >>> 4;
        switch (this.opcode) {
          case 0x73:
            break;
          case 0x74:
            C += 16;
            break;
          case 0x75:
            C += 32;
            break;
        }
        C = (C + this.GS.deltaBase) | 0;
        if (this.currentPpem() === C) {
          B = (((B >>> 0) & 0xf) - 8) | 0;
          if (B >= 0) B++;
          B = idiv(Math.imul(B, 64), 1 << this.GS.deltaShift);
          this.moveCvt(A, B);
        }
      }
    }
    this.newTop = this.args;
  }

  insGETINFO(a: number): void {
    const v = this.stack[a]!;
    let K = 0;
    if ((v & 1) !== 0) K = 35;
    if ((v & 2) !== 0 && this.ttMetrics.rotated) K |= 0x80;
    if ((v & 4) !== 0 && this.ttMetrics.stretched) K |= 1 << 8;
    if ((v & 32) !== 0 && this.grayscale) K |= 1 << 12;
    this.stack[a] = K;
  }

  insUNKNOWN(_a: number): void {
    for (let i = 0; i < this.numIDefs; i++) {
      const def = this.defAt(this.IDefs, i);
      if ((def.opc & 0xff) === this.opcode && def.active) {
        if (this.callTop >= this.callSize) {
          this.error = FtErr.Stack_Overflow;
          return;
        }
        const call = this.callStack[this.callTop++]!;
        call.callerRange = this.curRange;
        call.callerIP = (this.IP + 1) | 0;
        call.curCount = 1;
        call.curRestart = def.start;
        call.curEnd = def.end;
        this.insGotoCodeRange(def.range, def.start);
        this.stepIns = false;
        return;
      }
    }
    this.error = FtErr.Invalid_Opcode;
  }

  // -------------------------------------------------------------------------------------------------------------------------------- TT_RunIns

  /** TT_RunIns: runs the code of the current range; an FT_Error number (0 = ok) */
  runIns(): number {
    let insCounter = 0;
    this.ttMetrics.ratio = 0;
    this.cvtStretched = this.metrics.xPpem !== this.metrics.yPpem;
    this.computeFuncs();
    this.computeRound(this.GS.roundState);
    do {
      this.opcode = this.code[this.IP]!;
      if ((this.length = OPCODE_LENGTH[this.opcode]!) < 0) {
        if (this.IP + 1 >= this.codeSize) return this.codeOverflow();
        this.length = (2 - Math.imul(this.length, this.code[this.IP + 1]!)) | 0;
      }
      if (this.IP + this.length > this.codeSize) return this.codeOverflow();
      const ppc = POP_PUSH_COUNT[this.opcode]!;
      this.args = (this.top - (ppc >> 4)) | 0;
      if (this.args < 0) {
        if (this.pedanticHinting) {
          this.error = FtErr.Too_Few_Arguments;
          return this.errorExit();
        }
        for (let i = 0; i < ppc >> 4; i++) this.stack[i] = 0;
        this.args = 0;
      }
      this.newTop = this.args + (ppc & 15);
      if (this.newTop > this.stackSize) {
        this.error = FtErr.Stack_Overflow;
        return this.errorExit();
      }
      this.stepIns = true;
      this.error = FtErr.Ok;
      dispatch(this, this.opcode, this.args);
      let suite = false;
      if (this.error !== FtErr.Ok) {
        if (this.error === FtErr.Invalid_Opcode) {
          let found = false;
          for (let i = 0; i < this.numIDefs; i++) {
            const def = this.defAt(this.IDefs, i);
            if (def.active && this.opcode === (def.opc & 0xff)) {
              if (this.callTop >= this.callSize) {
                this.error = FtErr.Invalid_Reference;
                return this.errorExit();
              }
              const callrec = this.callStack[this.callTop]!;
              callrec.callerRange = this.curRange;
              callrec.callerIP = (this.IP + 1) | 0;
              callrec.curCount = 1;
              callrec.curRestart = def.start;
              callrec.curEnd = def.end;
              if (this.insGotoCodeRange(def.range, def.start) === FAILURE) return this.errorExit();
              found = true;
              break;
            }
          }
          if (!found) {
            this.error = FtErr.Invalid_Opcode;
            return this.errorExit();
          }
          suite = true; // goto LSuiteLabel_
        } else return this.errorExit();
      }
      if (!suite) {
        this.top = this.newTop;
        if (this.stepIns) this.IP = (this.IP + this.length) | 0;
        if (++insCounter > MAX_RUNNABLE_OPCODES) return FtErr.Execution_Too_Long;
      }
      if (this.IP >= this.codeSize) {
        if (this.callTop > 0) {
          this.error = FtErr.Code_Overflow;
          return this.errorExit();
        }
        return FtErr.Ok;
      }
    } while (!this.instructionTrap);
    return FtErr.Ok;
  }

  private codeOverflow(): number {
    this.error = FtErr.Code_Overflow;
    return this.errorExit();
  }

  /** LErrorLabel_ */
  private errorExit(): number {
    if (this.error && !this.instructionTrap) this.size!.cvtReady = false;
    return this.error;
  }
}
