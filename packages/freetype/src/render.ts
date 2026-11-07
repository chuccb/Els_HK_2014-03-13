import { outlineGetCBox, outlineTranslate } from "./outline.ts";
import { GrayRaster } from "./raster.ts";
import type { GlyphSlot } from "./slot.ts";
import { FT_GLYPH_FORMAT, FT_PIXEL_MODE, FT_RENDER_MODE, FtErr, FtError } from "./types.ts";

/**
 * FT_Render_Glyph (ftobjs.c FT_Render_Glyph_Internal) + the smooth renderer (src/smooth/ftsmooth.c, ft_smooth_render_generic for FT_RENDER_MODE_NORMAL).
 * The exe's library holds raster1 (monochrome) before smooth in its renderer list: a NORMAL request first reaches raster1, which answers
 * Cannot_Render_Glyph, and then smooth, which draws; the result is the same on every call, so only smooth is ported.  Mono and LCD renders are the
 * documented limit: they throw.
 */

const INT_MAX = 0x7fffffff;
const raster = new GrayRaster();

/** ft_smooth_render_generic with mode = NORMAL, origin = NULL, no LCD filter */
function smoothRender(slot: GlyphSlot): number {
  const outline = slot.outline;
  const cbox = outlineGetCBox(outline);
  const xMin = cbox.xMin & ~63;
  const yMin = cbox.yMin & ~63;
  const xMax = (cbox.xMax + 63) & ~63;
  const yMax = (cbox.yMax + 63) & ~63;
  if (xMin < 0 && xMax > INT_MAX + xMin) return FtErr.Raster_Overflow;
  const width = (xMax - xMin) >> 6;
  if (yMin < 0 && yMax > INT_MAX + yMin) return FtErr.Raster_Overflow;
  const height = (yMax - yMin) >> 6;
  const bitmap = slot.bitmap;
  const pitch = width;
  const xShift = xMin | 0;
  const yShift = yMin | 0;
  const xLeft = xMin >> 6;
  const yTop = yMax >> 6;
  if (width > 0x7fff || height > 0x7fff) return FtErr.Raster_Overflow;
  bitmap.pixelMode = FT_PIXEL_MODE.GRAY;
  bitmap.numGrays = 256;
  bitmap.width = width;
  bitmap.rows = height;
  bitmap.pitch = pitch;
  outlineTranslate(outline, -xShift, -yShift);
  const size = pitch * height;
  // FT_ALLOC of 0 bytes gives NULL; otherwise zeroed memory
  bitmap.buffer = size > 0 ? new Uint8Array(size) : null;
  const error = raster.render(outline, bitmap);
  // the outline goes back where it was, whatever happened
  outlineTranslate(outline, xShift, yShift);
  if (error) {
    bitmap.buffer = null;
    return error;
  }
  slot.format = FT_GLYPH_FORMAT.BITMAP;
  slot.bitmapLeft = xLeft;
  slot.bitmapTop = yTop;
  return FtErr.Ok;
}

/** FT_Render_Glyph(slot, render_mode): 0 or an FT_Error */
export function renderGlyph(slot: GlyphSlot, mode: number): number {
  switch (slot.format) {
    case FT_GLYPH_FORMAT.BITMAP:
      return FtErr.Ok;
    case FT_GLYPH_FORMAT.OUTLINE:
      if (mode === FT_RENDER_MODE.NORMAL || mode === FT_RENDER_MODE.LIGHT) return smoothRender(slot);
      throw new FtError(FtErr.Unimplemented_Feature, `FT_Render_Glyph: render mode ${mode} (mono / LCD) is not ported`);
    default:
      return FtErr.Unimplemented_Feature;
  }
}
