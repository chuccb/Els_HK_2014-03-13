/**
 * Constants of FreeType 2.4.11 (the version statically linked into x2.exe: FT_New_Library 0x32835EE0 stores 2, 4, 11).  Names and values are those of
 * fterrdef.h, freetype.h, ftimage.h.  Errors are returned the way the C API does (a number, 0 = FT_Err_Ok) because the exe's code checks them
 * (CKTDGFreeTypeFont::Load, CharToSystemTexture).
 */

/** FT_Error values (fterrdef.h; the TrueType / SFNT ones are the unprefixed values of the same file) */
export const FtErr = {
  Ok: 0x00,
  Cannot_Open_Resource: 0x01,
  Unknown_File_Format: 0x02,
  Invalid_File_Format: 0x03,
  Invalid_Version: 0x04,
  Invalid_Argument: 0x06,
  Unimplemented_Feature: 0x07,
  Invalid_Table: 0x08,
  Invalid_Offset: 0x09,
  Array_Too_Large: 0x0a,
  Missing_Module: 0x0b,
  Invalid_Glyph_Index: 0x10,
  Invalid_Character_Code: 0x11,
  Invalid_Glyph_Format: 0x12,
  Cannot_Render_Glyph: 0x13,
  Invalid_Outline: 0x14,
  Invalid_Composite: 0x15,
  Too_Many_Hints: 0x16,
  Invalid_Pixel_Size: 0x17,
  Invalid_Handle: 0x20,
  Invalid_Face_Handle: 0x23,
  Invalid_Size_Handle: 0x24,
  Invalid_CharMap_Handle: 0x26,
  Out_Of_Memory: 0x40,
  Invalid_Stream_Operation: 0x55,
  Invalid_Frame_Read: 0x58,
  Raster_Uninitialized: 0x60,
  Raster_Corrupted: 0x61,
  Raster_Overflow: 0x62,
  Raster_Negative_Height: 0x63,
  // TrueType bytecode interpreter
  Invalid_Opcode: 0x80,
  Too_Few_Arguments: 0x81,
  Stack_Overflow: 0x82,
  Code_Overflow: 0x83,
  Bad_Argument: 0x84,
  Divide_By_Zero: 0x85,
  Invalid_Reference: 0x86,
  Debug_OpCode: 0x87,
  ENDF_In_Exec_Stream: 0x88,
  Nested_DEFS: 0x89,
  Invalid_CodeRange: 0x8a,
  Execution_Too_Long: 0x8b,
  Too_Many_Function_Defs: 0x8c,
  Too_Many_Instruction_Defs: 0x8d,
  Table_Missing: 0x8e,
  Horiz_Header_Missing: 0x8f,
  Locations_Missing: 0x90,
  Name_Table_Missing: 0x91,
  CMap_Table_Missing: 0x92,
  Hmtx_Table_Missing: 0x93,
  Post_Table_Missing: 0x94,
  Invalid_Horiz_Metrics: 0x95,
  Invalid_CharMap_Format: 0x96,
  Invalid_PPem: 0x97,
  Invalid_Vert_Metrics: 0x98,
  Could_Not_Find_Context: 0x99,
  Invalid_Post_Table_Format: 0x9a,
  Invalid_Post_Table: 0x9b,
} as const;

/** thrown by the readers when a table is cut short; the C code reports FT_Err_Invalid_Stream_Operation (0x55) */
export class FtError extends Error {
  constructor(readonly code: number, message?: string) {
    super(message ?? `FreeType error 0x${code.toString(16)}`);
  }
}

/** FT_LOAD_* (freetype.h) */
export const FT_LOAD = {
  DEFAULT: 0,
  NO_SCALE: 1 << 0,
  NO_HINTING: 1 << 1,
  RENDER: 1 << 2,
  NO_BITMAP: 1 << 3,
  VERTICAL_LAYOUT: 1 << 4,
  FORCE_AUTOHINT: 1 << 5,
  CROP_BITMAP: 1 << 6,
  PEDANTIC: 1 << 7,
  ADVANCE_ONLY: 1 << 8,
  IGNORE_GLOBAL_ADVANCE_WIDTH: 1 << 9,
  NO_RECURSE: 1 << 10,
  IGNORE_TRANSFORM: 1 << 11,
  MONOCHROME: 1 << 12,
  LINEAR_DESIGN: 1 << 13,
  SBITS_ONLY: 1 << 14,
  NO_AUTOHINT: 1 << 15,
} as const;

/** FT_Render_Mode */
export const FT_RENDER_MODE = { NORMAL: 0, LIGHT: 1, MONO: 2, LCD: 3, LCD_V: 4 } as const;

/** FT_LOAD_TARGET_MODE(x) */
export const loadTargetMode = (flags: number): number => (flags >> 16) & 15;

/** FT_FACE_FLAG_* */
export const FT_FACE_FLAG = {
  SCALABLE: 1 << 0,
  FIXED_SIZES: 1 << 1,
  FIXED_WIDTH: 1 << 2,
  SFNT: 1 << 3,
  HORIZONTAL: 1 << 4,
  VERTICAL: 1 << 5,
  KERNING: 1 << 6,
  FAST_GLYPHS: 1 << 7,
  MULTIPLE_MASTERS: 1 << 8,
  GLYPH_NAMES: 1 << 9,
  EXTERNAL_STREAM: 1 << 10,
  HINTER: 1 << 11,
  CID_KEYED: 1 << 12,
  TRICKY: 1 << 13,
} as const;

/** FT_Glyph_Format (ftimage.h: four-character tags) */
export const FT_GLYPH_FORMAT = { NONE: 0, COMPOSITE: 0x636f6d70, BITMAP: 0x62697473, OUTLINE: 0x6f75746c, PLOTTER: 0x706c6f74 } as const;

/** FT_Pixel_Mode */
export const FT_PIXEL_MODE = { NONE: 0, MONO: 1, GRAY: 2, GRAY2: 3, GRAY4: 4, LCD: 5, LCD_V: 6 } as const;

/** FT_CURVE_TAG_* (the low bits of an outline tag) */
export const FT_CURVE_TAG = { ON: 1, CONIC: 0, CUBIC: 2, HAS_SCANMODE: 4, TOUCH_X: 8, TOUCH_Y: 16 } as const;

/** FT_Encoding for what the sfnt cmap finder needs */
export const FT_ENCODING = { NONE: 0, UNICODE: 0x756e6963, APPLE_ROMAN: 0x61726d6e, MS_SYMBOL: 0x73796d62 } as const;

/** the four-character table tags */
export const tag4 = (s: string): number => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;

/** FT_PIX_FLOOR / ROUND / CEIL (ftobjs.h) on 26.6 values */
export const pixFloor = (x: number): number => x & ~63;
export const pixRound = (x: number): number => (x + 32) & ~63;
export const pixCeil = (x: number): number => (x + 63) & ~63;
