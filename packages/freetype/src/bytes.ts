import { FtError, FtErr } from "./types.ts";

/**
 * A font file in memory.  FreeType reads it through an FT_Stream (ftstream.c: FT_Stream_OpenMemory, FT_GET_USHORT ... big-endian); every table of
 * this port is read with these accessors.  A read outside the file is an error of the stream (FT_Err_Invalid_Stream_Operation), never a wrap.
 */
export class Bytes {
  readonly data: Uint8Array;
  private readonly dv: DataView;

  constructor(data: Uint8Array) {
    this.data = data;
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get size(): number {
    return this.data.length;
  }

  private check(p: number, n: number): void {
    if (p < 0 || p + n > this.data.length) throw new FtError(FtErr.Invalid_Stream_Operation, `read of ${n} byte(s) at ${p} outside the file (${this.data.length})`);
  }

  u8(p: number): number {
    this.check(p, 1);
    return this.data[p]!;
  }
  s8(p: number): number {
    this.check(p, 1);
    return this.dv.getInt8(p);
  }
  u16(p: number): number {
    this.check(p, 2);
    return this.dv.getUint16(p);
  }
  s16(p: number): number {
    this.check(p, 2);
    return this.dv.getInt16(p);
  }
  u32(p: number): number {
    this.check(p, 4);
    return this.dv.getUint32(p);
  }
  s32(p: number): number {
    this.check(p, 4);
    return this.dv.getInt32(p);
  }
}
