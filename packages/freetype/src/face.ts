import { Bytes } from "./bytes.ts";
import { buildCmap, type TtCmap } from "./cmap.ts";
import { FtSize } from "./size.ts";
import { GlyphSlot } from "./slot.ts";
import { FT_ENCODING, FT_FACE_FLAG, FtErr, FtError, tag4 } from "./types.ts";

/**
 * FT_Face of the TrueType driver: the public FT_FaceRec fields plus what TT_FaceRec keeps (tttypes.h).  Loading follows, in order,
 * tt_face_init (ttobjs.c) -> sfnt_init_face / sfnt_open_font (sfobjs.c) -> tt_face_load_font_dir / check_table_dir (ttload.c) -> sfnt_load_face
 * (head, maxp, cmap, post, hhea, hmtx, vhea, vmtx, OS/2, EBLC, kern) -> tt_face_load_hdmx / loca / cvt / fpgm / prep (ttpload.c) -> find_unicode_charmap
 * (ftobjs.c open_face).
 *
 * NOT PORTED (none of them can change a result for the five shipped fonts, see FINDINGS 17.11):
 *  - the `name` table and everything built on it (family / style names), and with it tt_check_trickyness (FT_FACE_FLAG_TRICKY stays clear; the
 *    exe's faces of the five fonts have flag 0x2000 clear),
 *  - the `post` glyph-name tables (FT_Get_Glyph_Name; only the FT_FACE_FLAG_GLYPH_NAMES bit is computed), `PCLT`, `gasp`, GX variations
 *    (`doblend` stays false: none of the fonts has fvar / gvar), incremental fonts,
 *  - cmap formats other than 4, 6 and 12 (see cmap.ts).
 */

export interface BBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** FT_Bitmap_Size */
export interface BitmapSize {
  height: number;
  width: number;
  size: number;
  xPpem: number;
  yPpem: number;
}

/** FT_CharMapRec (+ the TT_CMap behind it) */
export interface CharMap {
  platformId: number;
  encodingId: number;
  encoding: number;
  cmap: TtCmap;
}

export interface TtHeader {
  tableVersion: number;
  fontRevision: number;
  checkSumAdjust: number;
  magicNumber: number;
  flags: number;
  unitsPerEM: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  macStyle: number;
  lowestRecPPEM: number;
  fontDirection: number;
  indexToLocFormat: number;
  glyphDataFormat: number;
}

export interface TtMaxProfile {
  version: number;
  numGlyphs: number;
  maxPoints: number;
  maxContours: number;
  maxCompositePoints: number;
  maxCompositeContours: number;
  maxZones: number;
  maxTwilightPoints: number;
  maxStorage: number;
  maxFunctionDefs: number;
  maxInstructionDefs: number;
  maxStackElements: number;
  maxSizeOfInstructions: number;
  maxComponentElements: number;
  maxComponentDepth: number;
}

/** TT_HoriHeader (hhea / vhea) */
export interface TtHoriHeader {
  version: number;
  ascender: number;
  descender: number;
  lineGap: number;
  advanceWidthMax: number;
  minLeftSideBearing: number;
  minRightSideBearing: number;
  xMaxExtent: number;
  caretSlopeRise: number;
  caretSlopeRun: number;
  caretOffset: number;
  metricDataFormat: number;
  numberOfHMetrics: number;
}

export interface TtOs2 {
  version: number;
  xAvgCharWidth: number;
  fsSelection: number;
  sTypoAscender: number;
  sTypoDescender: number;
  sTypoLineGap: number;
  usWinAscent: number;
  usWinDescent: number;
}

export interface DirTable {
  tag: number;
  checkSum: number;
  offset: number;
  length: number;
}

const TTAG = {
  OTTO: tag4("OTTO"),
  ttcf: tag4("ttcf"),
  true_: tag4("true"),
  typ1: tag4("typ1"),
  head: tag4("head"),
  bhed: tag4("bhed"),
  maxp: tag4("maxp"),
  cmap: tag4("cmap"),
  post: tag4("post"),
  hhea: tag4("hhea"),
  hmtx: tag4("hmtx"),
  vhea: tag4("vhea"),
  vmtx: tag4("vmtx"),
  OS2: tag4("OS/2"),
  EBLC: tag4("EBLC"),
  bloc: tag4("bloc"),
  kern: tag4("kern"),
  glyf: tag4("glyf"),
  CFF: tag4("CFF "),
  loca: tag4("loca"),
  cvt: tag4("cvt "),
  fpgm: tag4("fpgm"),
  prep: tag4("prep"),
  hdmx: tag4("hdmx"),
  SING: tag4("SING"),
  META: tag4("META"),
} as const;

const int16 = (v: number): number => (v << 16) >> 16;

/** sfnt_find_encoding (sfobjs.c): the FT_Encoding of a (platform, encoding) pair */
function sfntFindEncoding(platformId: number, encodingId: number): number {
  switch (platformId) {
    case 2: // TT_PLATFORM_ISO
    case 0: // TT_PLATFORM_APPLE_UNICODE
      return FT_ENCODING.UNICODE;
    case 1: // TT_PLATFORM_MACINTOSH
      return encodingId === 0 ? FT_ENCODING.APPLE_ROMAN : FT_ENCODING.NONE;
    case 3: // TT_PLATFORM_MICROSOFT
      switch (encodingId) {
        case 0:
          return FT_ENCODING.MS_SYMBOL;
        case 10: // TT_MS_ID_UCS_4
        case 1: // TT_MS_ID_UNICODE_CS
          return FT_ENCODING.UNICODE;
        case 2: // SJIS
          return 0x736a6973;
        case 3: // GB2312
          return 0x67622020;
        case 4: // BIG_5
          return 0x62696735;
        case 5: // WANSUNG
          return 0x77616e73;
        case 6: // JOHAB
          return 0x6a6f6861;
        default:
          return FT_ENCODING.NONE;
      }
    default:
      return FT_ENCODING.NONE;
  }
}

export class FtFace {
  // ---- FT_FaceRec
  numFaces = 0;
  faceIndex = 0;
  faceFlags = 0;
  styleFlags = 0;
  numGlyphs = 0;
  bbox: BBox = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  unitsPerEM = 0;
  ascender = 0;
  descender = 0;
  height = 0;
  maxAdvanceWidth = 0;
  maxAdvanceHeight = 0;
  underlinePosition = 0;
  underlineThickness = 0;
  availableSizes: BitmapSize[] = [];
  charmaps: CharMap[] = [];
  charmap: CharMap | null = null;
  /** face->size (FT_New_Size) and face->glyph (FT_New_GlyphSlot): created once the driver has accepted the face */
  size!: FtSize;
  glyph!: GlyphSlot;

  // ---- TT_FaceRec
  readonly stream: Bytes;
  formatTag = 0;
  ttcOffsets: number[] = [];
  dirTables: DirTable[] = [];
  header!: TtHeader;
  maxProfile!: TtMaxProfile;
  horizontal!: TtHoriHeader;
  vertical: TtHoriHeader | null = null;
  verticalInfo = false;
  os2: TtOs2 = { version: 0xffff, xAvgCharWidth: 0, fsSelection: 0, sTypoAscender: 0, sTypoDescender: 0, sTypoLineGap: 0, usWinAscent: 0, usWinDescent: 0 };
  postscript = { formatType: 0, isFixedPitch: 0, underlinePosition: 0, underlineThickness: 0 };
  /** [offset, size] of the cmap table in the file */
  cmapTable = 0;
  cmapSize = 0;
  horzMetricsOffset = 0;
  horzMetricsSize = 0;
  vertMetricsOffset = 0;
  vertMetricsSize = 0;
  kernAvailBits = 0;
  sbitTable = 0;
  sbitTableSize = 0;
  sbitNumStrikes = 0;
  glyfOffset = 0;
  glyfLen = 0;
  locaOffset = 0;
  numLocations = 0;
  hdmxOffset = 0;
  hdmxSize = 0;
  hdmxRecordCount = 0;
  hdmxRecordSize = 0;
  hdmxRecordSizes: number[] = [];
  cvt: Int16Array = new Int16Array(0);
  fontProgram: Uint8Array = new Uint8Array(0);
  cvtProgram: Uint8Array = new Uint8Array(0);
  locaLen = 0;

  private constructor(data: Uint8Array) {
    this.stream = new Bytes(data);
  }

  /**
   * FT_New_Memory_Face + the TrueType driver's init: throws FtError(code) where FT_Open_Face would return an error.  (FT_Open_Face tries the
   * drivers in the library's module order; the exe's list starts with `truetype`, and an error other than Unknown_File_Format stops the loop.
   * The other drivers cannot open a font that the truetype driver rejects with Unknown_File_Format and that is not Type 1 / CFF / ...: the
   * HK client only opens TrueType fonts, so that case is reported as FT_Err_Unknown_File_Format.)
   */
  static open(data: Uint8Array, faceIndex: number): FtFace {
    const f = new FtFace(data);
    f.init(faceIndex);
    f.glyph = new GlyphSlot(f);
    f.size = new FtSize(f);
    return f;
  }

  /** tt_face_goto_table: the table with this tag, or undefined (SFNT_Err_Table_Missing) */
  lookupTable(tag: number): DirTable | undefined {
    for (const t of this.dirTables) if (t.tag === tag) return t;
    return undefined;
  }

  private gotoTable(tag: number): DirTable {
    const t = this.lookupTable(tag);
    if (!t) throw new FtError(FtErr.Table_Missing);
    if (t.offset > this.stream.size) throw new FtError(FtErr.Invalid_Stream_Operation);
    return t;
  }

  // ------------------------------------------------------------------------------------------------------------------------------------

  private init(faceIndex: number): void {
    const b = this.stream;
    // sfnt_open_font
    const tag = b.u32(0);
    if (tag !== 0x00010000 && tag !== TTAG.ttcf && tag !== TTAG.OTTO && tag !== TTAG.true_ && tag !== TTAG.typ1 && tag !== 0x00020000) {
      throw new FtError(FtErr.Unknown_File_Format);
    }
    if (tag === TTAG.ttcf) {
      const count = b.u32(8);
      if (count === 0) throw new FtError(FtErr.Invalid_Table);
      if (count > Math.floor(b.size / (28 + 4))) throw new FtError(FtErr.Array_Too_Large);
      for (let n = 0; n < count; n++) this.ttcOffsets.push(b.u32(12 + n * 4));
    } else this.ttcOffsets = [0];
    // sfnt_init_face
    if (faceIndex < 0) faceIndex = 0;
    if (faceIndex >= this.ttcOffsets.length) throw new FtError(FtErr.Invalid_Argument);
    this.loadFontDir(this.ttcOffsets[faceIndex]!);
    this.numFaces = this.ttcOffsets.length;
    this.faceIndex = faceIndex;
    // tt_face_init
    if (this.formatTag !== 0x00010000 && this.formatTag !== 0x00020000 && this.formatTag !== TTAG.true_) throw new FtError(FtErr.Unknown_File_Format);
    this.faceFlags |= FT_FACE_FLAG.HINTER;
    this.loadFace();
    this.loadHdmx();
    if (this.faceFlags & FT_FACE_FLAG.SCALABLE) {
      this.loadLoca();
      this.loadCvt();
      this.loadFpgm();
      this.loadPrep();
      if (this.availableSizes.length > 0 && this.numLocations > 0 && this.checkSingleNotdef()) this.faceFlags &= ~FT_FACE_FLAG.SCALABLE;
    }
    // open_face: find_unicode_charmap (the error is ignored when it is Invalid_CharMap_Handle: a face without Unicode cmap stays usable)
    this.findUnicodeCharmap();
  }

  /** tt_face_load_font_dir + check_table_dir */
  private loadFontDir(offset: number): void {
    const b = this.stream;
    this.formatTag = b.u32(offset);
    let numTables = b.u16(offset + 4);
    if (this.formatTag !== TTAG.OTTO) {
      // check_table_dir
      let validEntries = 0;
      let hasHead = false;
      let hasSing = false;
      let hasMeta = false;
      const base = offset + 12;
      let nn = 0;
      for (; nn < numTables; nn++) {
        const p = base + nn * 16;
        if (p + 16 > b.size) {
          numTables = nn; // can read only nn tables in font
          break;
        }
        const tg = b.u32(p);
        const off = b.u32(p + 8);
        const len = b.u32(p + 12);
        if (((off + len) >>> 0) > b.size || off + len >= 0x100000000) continue;
        validEntries++;
        if (tg === TTAG.head || tg === TTAG.bhed) {
          hasHead = true;
          if (len < 0x36) throw new FtError(FtErr.Table_Missing);
          if (b.u32(off + 12) !== 0x5f0f3cf5) throw new FtError(FtErr.Table_Missing);
        } else if (tg === TTAG.SING) hasSing = true;
        else if (tg === TTAG.META) hasMeta = true;
      }
      numTables = validEntries;
      if (numTables === 0) throw new FtError(FtErr.Unknown_File_Format);
      if (!(hasHead || (hasSing && hasMeta))) throw new FtError(FtErr.Table_Missing);
    }
    // the directory proper: entries that do not fit in the file are dropped
    this.dirTables = [];
    const raw = b.u16(offset + 4);
    for (let nn = 0; nn < raw && this.dirTables.length < numTables; nn++) {
      const p = offset + 12 + nn * 16;
      const t: DirTable = { tag: b.u32(p), checkSum: b.u32(p + 4), offset: b.u32(p + 8), length: b.u32(p + 12) };
      if (((t.offset + t.length) >>> 0) > b.size || t.offset + t.length >= 0x100000000) continue;
      this.dirTables.push(t);
    }
  }

  /** sfnt_load_face */
  private loadFace(): void {
    const b = this.stream;
    const hasOutline = this.lookupTable(TTAG.glyf) !== undefined || this.lookupTable(TTAG.CFF) !== undefined;
    let hasOutlineFlag = hasOutline;
    // head (the Apple `bhed` of bitmap-only fonts is only tried when there is no outline; the shipped fonts all have glyf)
    if (!hasOutline) throw new FtError(FtErr.Unimplemented_Feature, "font without glyf / CFF table (bitmap-only sfnt) is not ported");
    const head = this.gotoTable(TTAG.head);
    {
      const p = head.offset;
      this.header = {
        tableVersion: b.u32(p),
        fontRevision: b.u32(p + 4),
        checkSumAdjust: b.s32(p + 8),
        magicNumber: b.s32(p + 12),
        flags: b.u16(p + 16),
        unitsPerEM: b.u16(p + 18),
        xMin: b.s16(p + 36),
        yMin: b.s16(p + 38),
        xMax: b.s16(p + 40),
        yMax: b.s16(p + 42),
        macStyle: b.u16(p + 44),
        lowestRecPPEM: b.u16(p + 46),
        fontDirection: b.s16(p + 48),
        indexToLocFormat: b.s16(p + 50),
        glyphDataFormat: b.s16(p + 52),
      };
    }
    if (this.header.unitsPerEM === 0) throw new FtError(FtErr.Invalid_Table);
    // maxp
    {
      const t = this.gotoTable(TTAG.maxp);
      const p = t.offset;
      const m: TtMaxProfile = {
        version: b.s32(p),
        numGlyphs: b.u16(p + 4),
        maxPoints: 0,
        maxContours: 0,
        maxCompositePoints: 0,
        maxCompositeContours: 0,
        maxZones: 0,
        maxTwilightPoints: 0,
        maxStorage: 0,
        maxFunctionDefs: 0,
        maxInstructionDefs: 0,
        maxStackElements: 0,
        maxSizeOfInstructions: 0,
        maxComponentElements: 0,
        maxComponentDepth: 0,
      };
      if (m.version >= 0x10000) {
        m.maxPoints = b.u16(p + 6);
        m.maxContours = b.u16(p + 8);
        m.maxCompositePoints = b.u16(p + 10);
        m.maxCompositeContours = b.u16(p + 12);
        m.maxZones = b.u16(p + 14);
        m.maxTwilightPoints = b.u16(p + 16);
        m.maxStorage = b.u16(p + 18);
        m.maxFunctionDefs = b.u16(p + 20);
        m.maxInstructionDefs = b.u16(p + 22);
        m.maxStackElements = b.u16(p + 24);
        m.maxSizeOfInstructions = b.u16(p + 26);
        m.maxComponentElements = b.u16(p + 28);
        m.maxComponentDepth = b.u16(p + 30);
        if (m.maxFunctionDefs < 64) m.maxFunctionDefs = 64;
        if (m.maxTwilightPoints > 0xffff - 4) m.maxTwilightPoints = 0xffff - 4;
        if (m.maxComponentDepth > 100) m.maxComponentDepth = 100;
      }
      this.maxProfile = m;
    }
    // cmap (the table is only located here; tt_face_build_cmaps runs below)
    {
      const t = this.lookupTable(TTAG.cmap);
      if (t) {
        this.cmapTable = t.offset;
        this.cmapSize = t.length;
      }
    }
    // post
    let psnamesOk = false;
    {
      const t = this.lookupTable(TTAG.post);
      if (t && t.offset + 32 <= b.size) {
        const p = t.offset;
        this.postscript = { formatType: b.u32(p), isFixedPitch: b.u32(p + 12), underlinePosition: b.s16(p + 8), underlineThickness: b.s16(p + 10) };
        psnamesOk = true;
      }
    }
    // hhea / hmtx
    const hhea = this.lookupTable(TTAG.hhea);
    if (!hhea) {
      if (this.formatTag === TTAG.true_) hasOutlineFlag = false;
      else throw new FtError(FtErr.Horiz_Header_Missing);
    } else {
      this.horizontal = this.readHoriHeader(hhea.offset);
      const hmtx = this.lookupTable(TTAG.hmtx);
      if (!hmtx) throw new FtError(FtErr.Hmtx_Table_Missing);
      this.horzMetricsOffset = hmtx.offset;
      this.horzMetricsSize = hmtx.length;
    }
    // vhea / vmtx
    {
      const vhea = this.lookupTable(TTAG.vhea);
      if (vhea) {
        this.vertical = this.readHoriHeader(vhea.offset);
        const vmtx = this.lookupTable(TTAG.vmtx);
        if (vmtx) {
          this.vertMetricsOffset = vmtx.offset;
          this.vertMetricsSize = vmtx.length;
          this.verticalInfo = true;
        }
      }
    }
    // OS/2
    {
      const t = this.lookupTable(TTAG.OS2);
      if (t && t.offset + 78 <= b.size) {
        const p = t.offset;
        this.os2 = {
          version: b.u16(p),
          xAvgCharWidth: b.s16(p + 2),
          fsSelection: b.u16(p + 62),
          sTypoAscender: b.s16(p + 68),
          sTypoDescender: b.s16(p + 70),
          sTypoLineGap: b.s16(p + 72),
          usWinAscent: b.u16(p + 74),
          usWinDescent: b.u16(p + 76),
        };
      } else this.os2.version = 0xffff;
    }
    // EBLC (embedded bitmap strikes): only the strike table is read (the bitmaps themselves are never decoded, see glyph.ts)
    this.loadEblc();
    // kern: only whether a usable horizontal table exists
    this.loadKern();

    this.numGlyphs = this.maxProfile.numGlyphs;

    // face flags
    let flags = this.faceFlags;
    if (hasOutlineFlag) flags |= FT_FACE_FLAG.SCALABLE;
    flags |= FT_FACE_FLAG.SFNT | FT_FACE_FLAG.HORIZONTAL;
    if (psnamesOk && this.postscript.formatType !== 0x00030000) flags |= FT_FACE_FLAG.GLYPH_NAMES;
    if (this.postscript.isFixedPitch) flags |= FT_FACE_FLAG.FIXED_WIDTH;
    if (this.verticalInfo) flags |= FT_FACE_FLAG.VERTICAL;
    if (this.kernAvailBits !== 0) flags |= FT_FACE_FLAG.KERNING;
    this.faceFlags = flags;
    // style flags
    flags = 0;
    if (hasOutlineFlag && this.os2.version !== 0xffff) {
      if (this.os2.fsSelection & 512) flags |= 1;
      else if (this.os2.fsSelection & 1) flags |= 1;
      if (this.os2.fsSelection & 32) flags |= 2;
    } else {
      if (this.header.macStyle & 1) flags |= 2;
      if (this.header.macStyle & 2) flags |= 1;
    }
    this.styleFlags = flags;
    // charmaps
    this.buildCmaps();
    // fixed sizes
    this.buildAvailableSizes();
    if (!(this.faceFlags & FT_FACE_FLAG.FIXED_SIZES) && !(this.faceFlags & FT_FACE_FLAG.SCALABLE)) this.faceFlags |= FT_FACE_FLAG.SCALABLE;
    if (this.faceFlags & FT_FACE_FLAG.SCALABLE) {
      const h = this.header;
      this.bbox = { xMin: h.xMin, yMin: h.yMin, xMax: h.xMax, yMax: h.yMax };
      this.unitsPerEM = h.unitsPerEM;
      this.ascender = this.horizontal.ascender;
      this.descender = this.horizontal.descender;
      this.height = int16(this.ascender - this.descender + this.horizontal.lineGap);
      if (!(this.ascender || this.descender)) {
        if (this.os2.version !== 0xffff) {
          if (this.os2.sTypoAscender || this.os2.sTypoDescender) {
            this.ascender = this.os2.sTypoAscender;
            this.descender = this.os2.sTypoDescender;
            this.height = int16(this.ascender - this.descender + this.os2.sTypoLineGap);
          } else {
            this.ascender = int16(this.os2.usWinAscent);
            this.descender = -int16(this.os2.usWinDescent);
            this.height = (this.ascender - this.descender) & 0xffff;
          }
        }
      }
      this.maxAdvanceWidth = int16(this.horizontal.advanceWidthMax);
      this.maxAdvanceHeight = int16(this.verticalInfo ? this.vertical!.advanceWidthMax : this.height);
      this.underlinePosition = int16(this.postscript.underlinePosition - Math.trunc(this.postscript.underlineThickness / 2));
      this.underlineThickness = this.postscript.underlineThickness;
    }
    // FT_Open_Face, after the driver returned
    if (this.faceFlags & FT_FACE_FLAG.SCALABLE) {
      if (this.height < 0) this.height = int16(-this.height);
      if (!(this.faceFlags & FT_FACE_FLAG.VERTICAL)) this.maxAdvanceHeight = int16(this.height);
    }
    for (const s of this.availableSizes) {
      if (s.height < 0) s.height = int16(-s.height);
      if (s.xPpem < 0) s.xPpem = int16(-s.xPpem);
      if (s.yPpem < 0) s.yPpem = -s.yPpem;
    }
  }

  private readHoriHeader(p: number): TtHoriHeader {
    const b = this.stream;
    return {
      version: b.u32(p),
      ascender: b.s16(p + 4),
      descender: b.s16(p + 6),
      lineGap: b.s16(p + 8),
      advanceWidthMax: b.u16(p + 10),
      minLeftSideBearing: b.s16(p + 12),
      minRightSideBearing: b.s16(p + 14),
      xMaxExtent: b.s16(p + 16),
      caretSlopeRise: b.s16(p + 18),
      caretSlopeRun: b.s16(p + 20),
      caretOffset: b.s16(p + 22),
      metricDataFormat: b.s16(p + 32),
      numberOfHMetrics: b.u16(p + 34),
    };
  }

  /** tt_face_get_metrics (the FT_CONFIG_OPTION_OLD_INTERNALS variant of ttmtx.c: the whole table is read when the face is loaded) -> [bearing, advance] */
  getMetrics(vertical: boolean, gindex: number): [number, number] {
    const b = this.stream;
    const header = vertical ? this.vertical! : this.horizontal;
    const pos = vertical ? this.vertMetricsOffset : this.horzMetricsOffset;
    const size = vertical ? this.vertMetricsSize : this.horzMetricsSize;
    // tt_face_load_hmtx (OLD variant): number_Of_HMetrics is clipped to the table
    const k = Math.min(header.numberOfHMetrics, Math.floor(size / 4));
    if (k === 0 || gindex >= this.maxProfile.numGlyphs) return [0, 0];
    if (gindex < k) return [b.s16(pos + gindex * 4 + 2), b.u16(pos + gindex * 4)];
    // short metrics: the table may be shorter than numGlyphs says; the last available value is repeated
    const numShorts = this.maxProfile.numGlyphs - k;
    const numShortsChecked = Math.floor((size - k * 4) / 2);
    const advance = b.u16(pos + (k - 1) * 4);
    const idx = gindex - k;
    if (idx >= numShorts) return [0, advance];
    if (idx < numShortsChecked) return [b.s16(pos + k * 4 + idx * 2), advance];
    return [numShortsChecked > 0 ? b.s16(pos + k * 4 + (numShortsChecked - 1) * 2) : 0, advance];
  }

  /** tt_face_load_eblc */
  private loadEblc(): void {
    const b = this.stream;
    this.sbitNumStrikes = 0;
    const t = this.lookupTable(TTAG.EBLC) ?? this.lookupTable(TTAG.bloc);
    if (!t) return;
    if (t.length < 8) throw new FtError(FtErr.Invalid_File_Format);
    this.sbitTable = t.offset;
    this.sbitTableSize = t.length;
    const version = b.u32(t.offset);
    const numStrikes = b.u32(t.offset + 4);
    if (version !== 0x00020000 || numStrikes >= 0x10000) {
      this.sbitTableSize = 0;
      throw new FtError(FtErr.Invalid_File_Format);
    }
    let count = numStrikes;
    if (8 + 48 * count > t.length) count = Math.floor((t.length - 8) / 48);
    this.sbitNumStrikes = count;
  }

  /** tt_face_load_strike_metrics -> [x_ppem, y_ppem, ascender, descender, height, max_advance] */
  loadStrikeMetrics(strikeIndex: number): { xPpem: number; yPpem: number; ascender: number; descender: number; height: number; maxAdvance: number } {
    if (strikeIndex >= this.sbitNumStrikes) throw new FtError(FtErr.Invalid_Argument);
    const b = this.stream;
    const s = this.sbitTable + 8 + strikeIndex * 48;
    const ascender = b.s8(s + 16) << 6;
    const descender = b.s8(s + 17) << 6;
    return {
      xPpem: b.u8(s + 44),
      yPpem: b.u8(s + 45),
      ascender,
      descender,
      height: ascender - descender,
      maxAdvance: (b.s8(s + 22) + b.u8(s + 18) + b.s8(s + 23)) << 6,
    };
  }

  /** the FT_Bitmap_Size list of sfnt_load_face */
  private buildAvailableSizes(): void {
    const count = this.sbitNumStrikes;
    if (count <= 0) return;
    let emSize = this.header.unitsPerEM;
    let avgWidth = this.os2.xAvgCharWidth;
    if (emSize === 0 || this.os2.version === 0xffff) {
      avgWidth = 0;
      emSize = 1;
    }
    for (let i = 0; i < count; i++) {
      const m = this.loadStrikeMetrics(i);
      this.availableSizes.push({
        height: int16(m.height >> 6),
        width: int16(Math.trunc((avgWidth * m.xPpem + Math.trunc(emSize / 2)) / emSize)),
        xPpem: int16(m.xPpem << 6),
        yPpem: m.yPpem << 6,
        size: m.yPpem << 6,
      });
    }
    this.faceFlags |= FT_FACE_FLAG.FIXED_SIZES;
  }

  /** tt_face_load_kern: only `kern_avail_bits` (TT_FACE_HAS_KERNING) is needed, for FT_FACE_FLAG_KERNING */
  private loadKern(): void {
    const b = this.stream;
    const t = this.lookupTable(TTAG.kern);
    if (!t || t.length < 4) return;
    let p = t.offset + 2;
    const pLimit = t.offset + t.length;
    let numTables = b.u16(p);
    p += 2;
    if (numTables > 32) numTables = 32;
    let avail = 0;
    for (let nn = 0; nn < numTables; nn++) {
      const mask = (1 << nn) >>> 0;
      if (p + 6 > pLimit) break;
      let pNext = p;
      p += 2;
      const length = b.u16(p);
      const coverage = b.u16(p + 2);
      p += 4;
      if (length <= 6) break;
      pNext += length;
      if (pNext > pLimit) pNext = pLimit;
      if ((coverage & ~8) === 0x0001 && p + 8 <= pLimit) avail = (avail | mask) >>> 0;
      p = pNext;
    }
    this.kernAvailBits = avail;
  }

  /** tt_face_build_cmaps + the encoding assignment of sfnt_load_face */
  private buildCmaps(): void {
    const b = this.stream;
    this.charmaps = [];
    const table = this.cmapTable;
    const limit = table + this.cmapSize;
    if (!table || table + 4 > limit) return; // SFNT_Err_Invalid_Table: the face stays without cmaps
    if (b.u16(table) !== 0) return;
    let numCmaps = b.u16(table + 2);
    let p = table + 4;
    for (; numCmaps > 0 && p + 8 <= limit; numCmaps--) {
      const platformId = b.u16(p);
      const encodingId = b.u16(p + 2);
      const offset = b.u32(p + 4);
      p += 8;
      if (offset && offset <= this.cmapSize - 2) {
        const cm = buildCmap(b, table, limit, table + offset);
        if (cm) this.charmaps.push({ platformId, encodingId, encoding: sfntFindEncoding(platformId, encodingId), cmap: cm });
      }
    }
  }

  /** find_unicode_charmap (ftobjs.c): the last UCS-4 map, else the last Unicode map */
  private findUnicodeCharmap(): void {
    const cms = this.charmaps;
    for (let i = cms.length - 1; i >= 0; i--) {
      const c = cms[i]!;
      if (c.encoding === FT_ENCODING.UNICODE && ((c.platformId === 3 && c.encodingId === 10) || (c.platformId === 0 && c.encodingId === 4))) {
        this.charmap = c;
        return;
      }
    }
    for (let i = cms.length - 1; i >= 0; i--) {
      if (cms[i]!.encoding === FT_ENCODING.UNICODE) {
        this.charmap = cms[i]!;
        return;
      }
    }
  }

  /** FT_Get_Char_Index */
  getCharIndex(charcode: number): number {
    return this.charmap ? this.charmap.cmap.charIndex(charcode >>> 0) : 0;
  }

  // ---- ttpload.c

  private loadHdmx(): void {
    const b = this.stream;
    const t = this.lookupTable(TTAG.hdmx);
    if (!t || t.length < 8) return;
    let p = t.offset;
    const limit = p + t.length;
    const version = b.u16(p);
    const numRecords = b.u16(p + 2);
    let recordSize = b.u32(p + 4);
    p += 8;
    if (recordSize >= 0xffff0000) recordSize &= 0xffff;
    if (version !== 0 || numRecords > 255 || recordSize > 0x10001) throw new FtError(FtErr.Invalid_File_Format);
    this.hdmxRecordSizes = [];
    let nn = 0;
    for (; nn < numRecords; nn++) {
      if (p + recordSize > limit) break;
      this.hdmxRecordSizes.push(b.u8(p));
      p += recordSize;
    }
    this.hdmxRecordCount = nn;
    this.hdmxOffset = t.offset;
    this.hdmxSize = t.length;
    this.hdmxRecordSize = recordSize;
  }

  /** tt_face_get_device_metrics: the hdmx advance (pixels) of a glyph at this ppem, or -1 */
  getDeviceMetrics(ppem: number, gindex: number): number {
    const recordSize = this.hdmxRecordSize;
    const record = this.hdmxOffset + 8;
    for (let nn = 0; nn < this.hdmxRecordCount; nn++) {
      if (this.hdmxRecordSizes[nn] === ppem) {
        gindex += 2;
        if (gindex < recordSize) return this.stream.u8(record + nn * recordSize + gindex);
        break;
      }
    }
    return -1;
  }

  private loadLoca(): void {
    const g = this.lookupTable(TTAG.glyf);
    this.glyfLen = g ? g.length : 0;
    const l = this.lookupTable(TTAG.loca);
    if (!l) throw new FtError(FtErr.Locations_Missing);
    let tableLen = l.length;
    let shift: number;
    if (this.header.indexToLocFormat !== 0) {
      shift = 2;
      if (tableLen >= 0x40000) throw new FtError(FtErr.Invalid_Table);
    } else {
      shift = 1;
      if (tableLen >= 0x20000) throw new FtError(FtErr.Invalid_Table);
    }
    this.numLocations = tableLen >>> shift;
    if (this.numLocations !== this.numGlyphs + 1) {
      if (this.numLocations <= this.numGlyphs) {
        const newLocaLen = (this.numGlyphs + 1) << shift;
        const pos = l.offset;
        // ftobjs-era quirk of tt_face_load_loca: the loop that looks for the nearest following table is followed by `if ( entry == limit )`,
        // which is always true after the loop, so the available distance is always taken to the end of the file
        const dist = this.stream.size - pos;
        if (newLocaLen <= dist) {
          this.numLocations = this.numGlyphs + 1;
          tableLen = newLocaLen;
        }
      }
    }
    this.locaOffset = l.offset;
    this.locaLen = tableLen;
    if (g) this.glyfOffset = g.offset;
  }

  /** tt_face_get_location -> [offset into glyf, size] */
  getLocation(gindex: number): [number, number] {
    const b = this.stream;
    let pos1 = 0;
    let pos2 = 0;
    if (gindex < this.numLocations) {
      if (this.header.indexToLocFormat !== 0) {
        const p = this.locaOffset + gindex * 4;
        const pLimit = this.locaOffset + this.numLocations * 4;
        pos1 = b.u32(p);
        pos2 = pos1;
        if (p + 8 <= pLimit) pos2 = b.u32(p + 4);
      } else {
        const p = this.locaOffset + gindex * 2;
        const pLimit = this.locaOffset + this.numLocations * 2;
        pos1 = b.u16(p);
        pos2 = pos1;
        if (p + 4 <= pLimit) pos2 = b.u16(p + 2);
        pos1 = (pos1 << 1) >>> 0;
        pos2 = (pos2 << 1) >>> 0;
      }
    }
    if (pos1 > this.glyfLen) return [0, 0];
    if (pos2 > this.glyfLen) pos2 = this.glyfLen;
    const size = pos2 >= pos1 ? pos2 - pos1 : this.glyfLen - pos1;
    return [pos1, size];
  }

  /** tt_check_single_notdef (the glyph-name branch is not needed: it only runs when exactly one glyph other than 0 has an outline) */
  private checkSingleNotdef(): boolean {
    let count = 0;
    let glyphIndex = 0;
    for (let i = 0; i < this.numLocations; i++) {
      const [, size] = this.getLocation(i);
      if (size > 0) {
        count++;
        if (count > 1) break;
        glyphIndex = i;
      }
    }
    if (count === 1) {
      if (glyphIndex === 0) return true;
      throw new FtError(FtErr.Unimplemented_Feature, "tt_check_single_notdef needs the post glyph names (not ported)");
    }
    return false;
  }

  private loadCvt(): void {
    const t = this.lookupTable(TTAG.cvt);
    if (!t) {
      this.cvt = new Int16Array(0);
      return;
    }
    const n = t.length >>> 1;
    const a = new Int16Array(n);
    for (let i = 0; i < n; i++) a[i] = this.stream.s16(t.offset + i * 2);
    this.cvt = a;
  }

  private loadFpgm(): void {
    const t = this.lookupTable(TTAG.fpgm);
    this.fontProgram = t ? this.stream.data.subarray(t.offset, t.offset + t.length) : new Uint8Array(0);
  }

  private loadPrep(): void {
    const t = this.lookupTable(TTAG.prep);
    this.cvtProgram = t ? this.stream.data.subarray(t.offset, t.offset + t.length) : new Uint8Array(0);
  }
}
