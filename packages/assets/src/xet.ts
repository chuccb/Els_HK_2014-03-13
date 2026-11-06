/**
 * `.xet` (mesh texture-change table) and `.tet` (texture UV-rectangle table) readers.
 *
 * Layouts decoded from `CKTDXDeviceXET_Preprocessing::OpenFile` (x2.exe.c L320512), `FindAniDataIndex` (L320196),
 * `CKTDXDeviceTET_Preprocessing::OpenFile` (L316826), `GetTexUV` (L316714) and `GetString` (L316683); the structs are
 * `KXETFormat*` / `KTETFormatTextureUV` in x2.exe.h. All integers little endian.
 *
 * XET  header (36 bytes): "XET " (0x20544558), version 256, A = #ChangeTexture, B = #AniData, C = #AniEventTexChange,
 *      MultiStage1 {nameOffset, colorOp}, MultiStage2 {nameOffset, colorOp}
 *      then  ChangeTexture[A]   {orgNameOffset, changeNameOffset}                              8 bytes
 *            AniData[B]         {nameOffset, transitionTime f32, aniMaxTime f32, numEvents u16, firstEvent u16}  16 bytes,
 *                               sorted by name for a case-insensitive binary search
 *            AniTexChangeEvent[C] {orgNameOffset, changeNameOffset, start f32, end f32}          16 bytes
 *      file size must be >= 36 + 8A + 16B + 16C. A file that does not start with the XET magic + version is accepted by the
 *      exe as "no data" (`parseXet` returns undefined).
 * TET  header (12 bytes): "TET " (0x20544554), version 256, N = #entries; then u32 nameOffset[N] sorted by name (wcscmp), then
 *      KTETFormatTextureUV[N] (40 bytes: leftTop, rightBottom, leftBottom, rightTop, rectSize as float pairs, in texels);
 *      file size must be >= 12 + 44 N, otherwise the exe rejects the file.
 * Strings: offset -> u16 length L, L UTF-16LE code units, a 0 terminator. Offset 0, an offset outside the file, L = 0 or a missing
 * terminator all read as the empty string (`GetString`).
 */

export interface XetChangeTexture { orgTexName: string; changeTexName: string }
export interface XetAniEvent { orgTexName: string; changeTexName: string; start: number; end: number }
export interface XetAniData {
  name: string;
  transitionTime: number;
  aniMaxTime: number;
  /** the events of this animation (`numAniEventTexChange` entries starting at `indexAniEventTexChange`) */
  events: XetAniEvent[];
}
export interface XetMultiStage { blendTexName: string; colorOp: number }
export interface XetFile {
  changeTextures: XetChangeTexture[];
  multiStage1: XetMultiStage;
  multiStage2: XetMultiStage;
  aniData: XetAniData[];
  /** all events in file order (AniData entries index into this) */
  events: XetAniEvent[];
  /**
   * `FindAniDataIndex`: the exe's binary search with `_wcsicmp` ordering over the table *as stored*. Several shipped files are
   * sorted case-sensitively, so for them this search misses some names that are present (reproduced on purpose).
   */
  findAniDataIndex(name: string): number;
}

export const XET_MAGIC = 0x20544558;
export const TET_MAGIC = 0x20544554;
const FORMAT_VERSION = 256;

/** `CKTDXDeviceXET_Preprocessing::GetString`: bounds-checked string at a file offset, "" when anything is off. */
export function readFormatString(b: Uint8Array, offset: number): string {
  if (offset === 0 || offset + 2 > b.length) return "";
  const len = b[offset]! | (b[offset + 1]! << 8);
  if (len === 0 || offset + len + 3 > b.length) return "";
  const end = offset + 2 + 2 * len;
  if (end + 2 > b.length || b[end] !== 0 || b[end + 1] !== 0) return "";
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[offset + 2 + 2 * i]! | (b[offset + 3 + 2 * i]! << 8));
  return s;
}

export function parseXet(b: Uint8Array): XetFile | undefined {
  if (b.length < 36) return undefined;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== XET_MAGIC || dv.getUint32(4, true) !== FORMAT_VERSION) return undefined;
  const a = dv.getUint32(8, true), n = dv.getUint32(12, true), c = dv.getUint32(16, true);
  const need = 8 * (a + 2 * (n + c)) + 36;
  if (!Number.isSafeInteger(need) || b.length < need) throw new RangeError(`XET: file too short for its tables (${b.length} < ${need})`);
  const str = (o: number): string => readFormatString(b, o);
  const changeBase = 36, aniBase = changeBase + 8 * a, evBase = aniBase + 16 * n;
  const changeTextures: XetChangeTexture[] = [];
  for (let i = 0; i < a; i++) {
    changeTextures.push({ orgTexName: str(dv.getUint32(changeBase + 8 * i, true)), changeTexName: str(dv.getUint32(changeBase + 8 * i + 4, true)) });
  }
  const events: XetAniEvent[] = [];
  for (let i = 0; i < c; i++) {
    const o = evBase + 16 * i;
    events.push({ orgTexName: str(dv.getUint32(o, true)), changeTexName: str(dv.getUint32(o + 4, true)), start: dv.getFloat32(o + 8, true), end: dv.getFloat32(o + 12, true) });
  }
  const aniData: XetAniData[] = [];
  for (let i = 0; i < n; i++) {
    const o = aniBase + 16 * i;
    const num = dv.getUint16(o + 12, true), first = dv.getUint16(o + 14, true);
    aniData.push({ name: str(dv.getUint32(o, true)), transitionTime: dv.getFloat32(o + 4, true), aniMaxTime: dv.getFloat32(o + 8, true), events: events.slice(first, first + num) });
  }
  return {
    changeTextures,
    multiStage1: { blendTexName: str(dv.getUint32(20, true)), colorOp: dv.getUint32(24, true) },
    multiStage2: { blendTexName: str(dv.getUint32(28, true)), colorOp: dv.getUint32(32, true) },
    aniData,
    events,
    findAniDataIndex: (name: string): number => {
      if (name === "") return -1;
      // std::lower_bound written the way x2.exe.c L320196 does it: count / half steps over 16-byte records
      let first = 0, count = n;
      while (count > 0) {
        const half = count >>> 1;
        if (compareIgnoreCase(aniData[first + half]!.name, name) >= 0) count = half;
        else { first += half + 1; count -= half + 1; }
      }
      return first !== n && compareIgnoreCase(name, aniData[first]!.name) >= 0 ? first : -1;
    },
  };
}

/** `_wcsicmp` in the C locale: compare after lower-casing each UTF-16 unit; a proper prefix sorts first. */
export function compareIgnoreCase(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let ca = a.charCodeAt(i), cb = b.charCodeAt(i);
    if (ca >= 65 && ca <= 90) ca += 32;
    if (cb >= 65 && cb <= 90) cb += 32;
    if (ca !== cb) return ca - cb;
  }
  return a.length - b.length;
}

export interface TetRect {
  leftTop: readonly [number, number];
  rightBottom: readonly [number, number];
  leftBottom: readonly [number, number];
  rightTop: readonly [number, number];
  rectSize: readonly [number, number];
}
export interface TetFile {
  /** key (as stored: upper case) -> rectangle, in file order */
  rects: ReadonlyMap<string, TetRect>;
  /** `GetTexUV`: exact (case-sensitive) key lookup, undefined when absent or the key is empty */
  getTexUV(key: string): TetRect | undefined;
}

/** `CKTDXDeviceTET_Preprocessing::OpenFile` + `GetTexUV`. Returns undefined where the exe rejects the file. */
export function parseTet(b: Uint8Array): TetFile | undefined {
  if (b.length < 12) return undefined;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== TET_MAGIC || dv.getUint32(4, true) !== FORMAT_VERSION) return undefined;
  const n = dv.getUint32(8, true);
  if (b.length < 44 * n + 12) return undefined;
  const rects = new Map<string, TetRect>();
  const recBase = 12 + 4 * n;
  for (let i = 0; i < n; i++) {
    const key = readFormatString(b, dv.getUint32(12 + 4 * i, true));
    const o = recBase + 40 * i;
    const f = (k: number): number => dv.getFloat32(o + 4 * k, true);
    if (!rects.has(key)) {
      rects.set(key, { leftTop: [f(0), f(1)], rightBottom: [f(2), f(3)], leftBottom: [f(4), f(5)], rightTop: [f(6), f(7)], rectSize: [f(8), f(9)] });
    }
  }
  return { rects, getTexUV: (key: string): TetRect | undefined => (key === "" ? undefined : rects.get(key)) };
}
