import { Bitmap } from "./slot.ts";
import { FT_PIXEL_MODE, FtError, FtErr } from "./types.ts";

/**
 * src/base/ftbitmap.c of FreeType 2.4.11: FT_Bitmap_Copy and FT_Bitmap_Embolden (the two the exe's CKTDGFreeTypeFont::CharToSystemTexture calls to make a
 * glyph's outline).  FT_Bitmap_Convert (4 / 2 bit gray, never produced by the smooth renderer) is not ported: embolden throws for those modes.
 *
 * `ft_bitmap_assure_buffer` allocates its new buffer with FT_QALLOC_MULT, which does not clear it, and the margins it adds (`ystr` rows on top, `xstr`
 * columns on the right) are read by the embolden loop.  The exe's FT_Memory is the CRT `malloc`, so in the exe those margins hold whatever the heap had;
 * this port (and the oracle's allocator) uses zeroed memory, which is also what later FreeType versions (FT_ALLOC_MULT) guarantee.
 */

/** FT_Bitmap_Copy(library, source, target) */
export function bitmapCopy(source: Bitmap, target: Bitmap): number {
  if (source === target) return FtErr.Ok;
  if (source.buffer === null) {
    assignBitmap(target, source);
    target.buffer = null;
    return FtErr.Ok;
  }
  const pitch = Math.abs(source.pitch);
  const size = pitch * source.rows;
  const buffer = new Uint8Array(size);
  assignBitmap(target, source);
  target.buffer = buffer;
  buffer.set(source.buffer.subarray(0, size));
  return FtErr.Ok;
}

function assignBitmap(to: Bitmap, from: Bitmap): void {
  to.rows = from.rows;
  to.width = from.width;
  to.pitch = from.pitch;
  to.buffer = from.buffer;
  to.numGrays = from.numGrays;
  to.pixelMode = from.pixelMode;
  to.paletteMode = from.paletteMode;
}

/** ft_bitmap_assure_buffer: room for `xpixels` more columns and `ypixels` more rows (added on top) */
function assureBuffer(bitmap: Bitmap, xpixels: number, ypixels: number): number {
  const width = bitmap.width;
  const height = bitmap.rows;
  const pitch = Math.abs(bitmap.pitch);
  let bpp: number;
  let newPitch: number;
  switch (bitmap.pixelMode) {
    case FT_PIXEL_MODE.MONO:
      bpp = 1;
      newPitch = (width + xpixels + 7) >> 3;
      break;
    case FT_PIXEL_MODE.GRAY2:
      bpp = 2;
      newPitch = (width + xpixels + 3) >> 2;
      break;
    case FT_PIXEL_MODE.GRAY4:
      bpp = 4;
      newPitch = (width + xpixels + 1) >> 1;
      break;
    case FT_PIXEL_MODE.GRAY:
    case FT_PIXEL_MODE.LCD:
    case FT_PIXEL_MODE.LCD_V:
      bpp = 8;
      newPitch = width + xpixels;
      break;
    default:
      return FtErr.Invalid_Glyph_Format;
  }
  const buf = bitmap.buffer!;
  if (ypixels === 0 && newPitch <= pitch) {
    // the existing buffer is wide enough: clear what lies right of the bitmap
    const bitWidth = pitch * 8;
    const bitLast = (width + xpixels) * bpp;
    if (bitLast < bitWidth) {
      let line = bitLast >> 3;
      let end = pitch;
      const shift = bitLast & 7;
      const mask = 0xff00 >> shift;
      for (let count = height; count > 0; count--, line += pitch, end += pitch) {
        let write = line;
        if (shift > 0) {
          buf[write] = buf[write]! & mask;
          write++;
        }
        if (write < end) buf.fill(0, write, end);
      }
    }
    return FtErr.Ok;
  }
  const out = new Uint8Array(newPitch * (bitmap.rows + ypixels));
  const len = (width * bpp + 7) >> 3;
  if (bitmap.pitch > 0) {
    for (let i = 0; i < bitmap.rows; i++) out.set(buf.subarray(pitch * i, pitch * i + len), newPitch * (ypixels + i));
  } else {
    for (let i = 0; i < bitmap.rows; i++) out.set(buf.subarray(pitch * i, pitch * i + len), newPitch * i);
  }
  bitmap.buffer = out;
  bitmap.pitch = bitmap.pitch < 0 ? -newPitch : newPitch;
  return FtErr.Ok;
}

/** FT_Bitmap_Embolden(library, bitmap, xStrength, yStrength): strengths in 26.6, rounded to whole pixels */
export function bitmapEmbolden(bitmap: Bitmap, xStrength: number, yStrength: number): number {
  if (!bitmap.buffer) return FtErr.Invalid_Argument;
  let xstr = (xStrength + 32) >> 6;
  let ystr = (yStrength + 32) >> 6;
  if (xstr === 0 && ystr === 0) return FtErr.Ok;
  if (xstr < 0 || ystr < 0) return FtErr.Invalid_Argument;
  switch (bitmap.pixelMode) {
    case FT_PIXEL_MODE.GRAY2:
    case FT_PIXEL_MODE.GRAY4:
      throw new FtError(FtErr.Unimplemented_Feature, "FT_Bitmap_Embolden of a 2 / 4 bit gray bitmap needs FT_Bitmap_Convert, which is not ported");
    case FT_PIXEL_MODE.MONO:
      if (xstr > 8) xstr = 8;
      break;
    case FT_PIXEL_MODE.LCD:
      xstr *= 3;
      break;
    case FT_PIXEL_MODE.LCD_V:
      ystr *= 3;
      break;
  }
  const error = assureBuffer(bitmap, xstr, ystr);
  if (error) return error;
  const buf = bitmap.buffer;
  let pitch = bitmap.pitch;
  let p: number;
  if (pitch > 0) p = pitch * ystr;
  else {
    pitch = -pitch;
    p = pitch * (bitmap.rows - 1);
  }
  const mono = bitmap.pixelMode === FT_PIXEL_MODE.MONO;
  const maxGray = bitmap.numGrays - 1;
  for (let y = 0; y < bitmap.rows; y++) {
    for (let x = pitch - 1; x >= 0; x--) {
      const tmp = buf[p + x]!;
      for (let i = 1; i <= xstr; i++) {
        if (mono) {
          buf[p + x] = buf[p + x]! | (tmp >> i);
          if (x > 0) buf[p + x] = buf[p + x]! | (buf[p + x - 1]! << (8 - i));
        } else if (x - i >= 0) {
          if (buf[p + x]! + buf[p + x - i]! > maxGray) {
            buf[p + x] = maxGray;
            break;
          }
          buf[p + x] = buf[p + x]! + buf[p + x - i]!;
          if (buf[p + x] === maxGray) break;
        } else break;
      }
    }
    for (let x = 1; x <= ystr; x++) {
      const q = p - bitmap.pitch * x;
      for (let i = 0; i < pitch; i++) buf[q + i] = buf[q + i]! | buf[p + i]!;
    }
    p += bitmap.pitch;
  }
  bitmap.width += xstr;
  bitmap.rows += ystr;
  return FtErr.Ok;
}
