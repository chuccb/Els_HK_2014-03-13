import { TtExec } from "./interp.ts";

/**
 * FT_Library: what the faces opened from it share.  For the exe that is the TrueType driver's one execution context (tt_driver_init -> TT_New_Context), so
 * bytecode state that outlives a glyph is shared by every face of the library: the `grayscale` flag, the stack and glyph-instruction buffers' sizes,
 * period / phase / threshold of the super-round instructions.  (The other modules of the exe's library -- 18 of them -- are not needed by the text path.)
 */
export class FtLibrary {
  readonly exec = new TtExec();
}

let theDefault: FtLibrary | undefined;

/** the library `FtFace.open` uses when it is not given one (the exe has one library for all its fonts) */
export const defaultLibrary = (): FtLibrary => (theDefault ??= new FtLibrary());
