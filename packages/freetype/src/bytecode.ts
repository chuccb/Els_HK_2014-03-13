import type { TtExec } from "./interp.ts";
import { mulFix } from "./calc.ts";
import type { FtSize } from "./size.ts";
import { GlyphZone, newDefaultGraphicsState, TT_CODERANGE } from "./ttypes.ts";
import { FtErr } from "./types.ts";

/**
 * The bytecode half of a TrueType size (ttobjs.c: tt_size_run_fpgm, tt_size_run_prep, tt_size_init_bytecode, tt_size_done_bytecode, tt_size_ready_bytecode).
 * All of them run on the library's one TtExec.
 */

const exec = (size: FtSize): TtExec => size.face.lib.exec;

/** tt_size_run_fpgm */
export function ttSizeRunFpgm(size: FtSize, pedantic: boolean): number {
  const face = size.face;
  const e = exec(size);
  e.loadContext(face, size);
  e.callTop = 0;
  e.top = 0;
  e.period = 64;
  e.phase = 0;
  e.threshold = 0;
  e.instructionTrap = false;
  e.FdotP = 0x4000;
  e.pedanticHinting = pedantic;
  e.metrics.xPpem = 0;
  e.metrics.yPpem = 0;
  e.metrics.xScale = 0;
  e.metrics.yScale = 0;
  e.ttMetrics.ppem = 0;
  e.ttMetrics.scale = 0;
  e.ttMetrics.ratio = 0x10000;
  e.setCodeRange(TT_CODERANGE.FONT, face.fontProgram, face.fontProgram.length);
  e.clearCodeRange(TT_CODERANGE.CVT);
  e.clearCodeRange(TT_CODERANGE.GLYPH);
  let error: number = FtErr.Ok;
  if (face.fontProgram.length > 0) {
    error = e.gotoCodeRange(TT_CODERANGE.FONT, 0);
    if (!error) error = e.runIns();
  }
  if (!error) e.saveContext(size);
  return error;
}

/** tt_size_run_prep */
export function ttSizeRunPrep(size: FtSize, pedantic: boolean): number {
  const face = size.face;
  const e = exec(size);
  e.loadContext(face, size);
  e.callTop = 0;
  e.top = 0;
  e.instructionTrap = false;
  e.pedanticHinting = pedantic;
  e.setCodeRange(TT_CODERANGE.CVT, face.cvtProgram, face.cvtProgram.length);
  e.clearCodeRange(TT_CODERANGE.GLYPH);
  let error: number = FtErr.Ok;
  if (face.cvtProgram.length > 0) {
    error = e.gotoCodeRange(TT_CODERANGE.CVT, 0);
    if (!error) error = e.runIns();
  }
  size.GS = { ...e.GS, dualVector: { ...e.GS.dualVector }, projVector: { ...e.GS.projVector }, freeVector: { ...e.GS.freeVector } };
  e.saveContext(size);
  return error;
}

/** tt_size_done_bytecode */
function ttSizeDoneBytecode(size: FtSize): void {
  size.cvt = new Int32Array(0);
  size.storage = new Int32Array(0);
  size.twilight = new GlyphZone();
  size.functionDefs = [];
  size.instructionDefs = [];
  size.numFunctionDefs = 0;
  size.maxFunctionDefs = 0;
  size.numInstructionDefs = 0;
  size.maxInstructionDefs = 0;
  size.maxFunc = 0;
  size.maxIns = 0;
  size.bytecodeReady = false;
  size.cvtReady = false;
}

/** tt_size_init_bytecode */
function ttSizeInitBytecode(size: FtSize, pedantic: boolean): number {
  const face = size.face;
  const maxp = face.maxProfile;
  size.bytecodeReady = true;
  size.cvtReady = false;
  size.maxFunctionDefs = maxp.maxFunctionDefs;
  size.maxInstructionDefs = maxp.maxInstructionDefs;
  size.numFunctionDefs = 0;
  size.numInstructionDefs = 0;
  size.maxFunc = 0;
  size.maxIns = 0;
  size.ttmetrics.rotated = false;
  size.ttmetrics.stretched = false;
  for (let i = 0; i < 4; i++) size.ttmetrics.compensations[i] = 0;
  const zeroDef = () => ({ range: 0, start: 0, end: 0, opc: 0, active: false, inlineDelta: false });
  size.functionDefs = Array.from({ length: size.maxFunctionDefs }, zeroDef);
  size.instructionDefs = Array.from({ length: size.maxInstructionDefs }, zeroDef);
  size.cvt = new Int32Array(face.cvt.length);
  size.storage = new Int32Array(maxp.maxStorage);
  const nTwilight = (maxp.maxTwilightPoints + 4) & 0xffff;
  size.twilight = GlyphZone.create(nTwilight, 0);
  size.twilight.nPoints = nTwilight;
  size.GS = newDefaultGraphicsState();
  const error = ttSizeRunFpgm(size, pedantic);
  if (error) ttSizeDoneBytecode(size);
  return error;
}

/** tt_size_ready_bytecode */
export function ttSizeReadyBytecode(size: FtSize, pedantic: boolean): number {
  let error: number = FtErr.Ok;
  if (!size.bytecodeReady) {
    error = ttSizeInitBytecode(size, pedantic);
    if (error) return error;
  }
  if (!size.cvtReady) {
    const face = size.face;
    for (let i = 0; i < size.cvt.length; i++) size.cvt[i] = mulFix(face.cvt[i]!, size.ttmetrics.scale);
    const tw = size.twilight;
    for (let i = 0; i < tw.nPoints; i++) {
      tw.org[2 * i] = 0;
      tw.org[2 * i + 1] = 0;
      tw.cur[2 * i] = 0;
      tw.cur[2 * i + 1] = 0;
    }
    size.storage.fill(0);
    size.GS = newDefaultGraphicsState();
    error = ttSizeRunPrep(size, pedantic);
    if (!error) size.cvtReady = true;
  }
  return error;
}
