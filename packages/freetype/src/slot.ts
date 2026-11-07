import type { FtFace } from "./face.ts";
import { GlyphLoader } from "./loader.ts";
import { Outline } from "./outline.ts";
import { FT_GLYPH_FORMAT } from "./types.ts";

/** FT_Bitmap (ftimage.h).  `buffer` is null for an empty bitmap (FT_Bitmap_New sets buffer = 0 too). */
export class Bitmap {
  rows = 0;
  width = 0;
  pitch = 0;
  buffer: Uint8Array | null = null;
  numGrays = 0;
  pixelMode = 0;
  paletteMode = 0;
}

/** FT_Glyph_Metrics (26.6 unless the glyph was loaded with FT_LOAD_NO_SCALE) */
export interface GlyphMetrics {
  width: number;
  height: number;
  horiBearingX: number;
  horiBearingY: number;
  horiAdvance: number;
  vertBearingX: number;
  vertBearingY: number;
  vertAdvance: number;
}

export const zeroMetrics = (): GlyphMetrics => ({
  width: 0,
  height: 0,
  horiBearingX: 0,
  horiBearingY: 0,
  horiAdvance: 0,
  vertBearingX: 0,
  vertBearingY: 0,
  vertAdvance: 0,
});

/** FT_GlyphSlotRec: where FT_Load_Glyph leaves the outline and FT_Render_Glyph the bitmap */
export class GlyphSlot {
  metrics: GlyphMetrics = zeroMetrics();
  linearHoriAdvance = 0;
  linearVertAdvance = 0;
  advance = { x: 0, y: 0 };
  format: number = FT_GLYPH_FORMAT.NONE;
  bitmap = new Bitmap();
  bitmapLeft = 0;
  bitmapTop = 0;
  outline = new Outline();
  numSubglyphs = 0;
  controlLen = 0;
  lsbDelta = 0;
  rsbDelta = 0;
  /** slot->internal->loader (FT_GlyphLoader_New + tt_slot_init's CreateExtra) */
  readonly loader = new GlyphLoader();

  constructor(readonly face: FtFace) {}

  /** ft_glyphslot_clear (ftobjs.c) */
  clear(): void {
    this.bitmap.buffer = null;
    this.metrics = zeroMetrics();
    this.outline.clear();
    this.bitmap.width = 0;
    this.bitmap.rows = 0;
    this.bitmap.pitch = 0;
    this.bitmap.pixelMode = 0;
    this.bitmapLeft = 0;
    this.bitmapTop = 0;
    this.numSubglyphs = 0;
    this.controlLen = 0;
    this.format = FT_GLYPH_FORMAT.NONE;
    this.linearHoriAdvance = 0;
    this.linearVertAdvance = 0;
    this.lsbDelta = 0;
    this.rsbDelta = 0;
  }
}
