/**
 * `item.kim` -- the pre-baked item database (a flat memory image of every `CX2Item::KItemFormatTemplet` plus the set-item table).
 *
 * `CX2ItemManager::OpenItemScriptFile` (32C49BC0) reads the file through the mass-file manager (KOM entry: XORCRC + zlib, which
 * `@els/kom` already undoes), `DoMemoryNotEncrypt` (32C4B4B0) validates it and keeps the whole buffer as `KItemFormatTemplet::ms_pData`;
 * every templet field that is not a plain number is an *offset into that buffer*. When the file is absent the exe falls back to running
 * `Item.lua` / `SetItem.lua`; the image is written by `KProxy2` (writer at L855618, x2.exe.c) from those same scripts.
 *
 * Layout (little endian; `GetSetItem` 32B8B730 and the writer fix the order, the structs are in x2.exe.h):
 *
 *   0x00  u32 magic 'KIM ' (0x204D494B)   u32 version 4609   u32 numItems N   u32 numSetIDs S
 *   0x10  u32 itemId[N]                  sorted ascending (the exe does `lower_bound`)
 *         KItemFormatTemplet[N]          188 bytes each, same order            (so the minimum size is 192*N + 16, the exe's check)
 *         u32 setId[S]                   sorted ascending
 *         KItemFormatSetItemData[S]      20 bytes each {setID, maxLevel, offSetName, offItemIDs, offNeedPartsNumNOptions}
 *         ... the pool: strings and variable length blocks that the offsets point to
 *
 *   KItemFormatTemplet (188 bytes): u32 itemID, flags, flags2; i32 itemLevel, quantity; f32 repairED; i32 repairVP, price,
 *     pricePvPPoint, setID; f32 addMaxMP; then 30 offsets (name, description, descriptionInShop, attachFrameName[6], modelName[6],
 *     textureChangeXET, aniXET, aniName, shopImage, dropViewer, descriptionInSkillNote, stat, buffFactorIndices, specialAbilityList,
 *     socketOptions, attachedParticleData, attachedMeshData, extra, randomSocketOptions, statRelationLevel), i16 endurance,
 *     enduranceDamageMin, enduranceDamageMax, u16 summonNpcID, and 16 bytes (buyPvpRankCondition, useLevel, unitType, unitClass,
 *     buffID, eqipPosition, coolTime, maxSealCount, maxAttribEnchantCount, attributeLevel, numFrameOffsets, numRenderScales,
 *     numRenderRotates, numCommonItemModelNames, numCommonItemXETNames, numSlashTraces).
 *
 *   Pool blocks (the accessors at 32B85150..32B85FD0): string = u16 length (0 means "none"), then NUL-terminated UTF-16 -- the exe
 *   uses the NUL, not the length, and so does this reader; stat = 5 f32; buffFactorIndices = u16 n + u16[n];
 *   specialAbilityList = u32 n + n * {type, coolTime, value1..3, offStringValue1} (24 bytes); socketOptions / randomSocketOptions =
 *   u32 n + i32[n]; attachedParticleData = u32 n + n * {offName, offBoneName}; attachedMeshData = u32 n + n * {offName | jiggle << 31,
 *   offBoneName}; statRelationLevel = 5 bytes; extra = frameOffsets[], renderScales[], renderRotates[], commonItemModelNames[],
 *   commonItemXETNames[], slashTraces[] back to back, each entry {u32 unitType, u32 value} (value: offset of a 3-float vector, offset of a
 *   string, or for slash traces {kind 0..3, ARGB}); set blocks: itemIDs = u32 n + u32[n], needPartsNumNOptions = u32 n + n * {u32, i32}.
 *   Offset 0 means "absent" everywhere; absent blocks read as the exe's zero-initialised dummies.
 */

export class KimFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KimFormatError";
  }
}

export const KIM_MAGIC = 0x204d494b;
export const KIM_VERSION = 4609;
export const KIM_HEADER_SIZE = 16;
export const KIM_TEMPLET_SIZE = 188;
export const KIM_SET_ENTRY_SIZE = 20;

/** `CX2Unit::UNIT_TYPE` */
export const UNIT_TYPE = { ELSWORD: 1, ARME: 2, LIRE: 3, RAVEN: 4, EVE: 5, CHUNG: 6, ARA: 7, ELESIS: 8, ADD: 9 } as const;

export interface KimVec3 { x: number; y: number; z: number }
export interface KimStat { baseHP: number; atkPhysic: number; atkMagic: number; defPhysic: number; defMagic: number }
export interface KimStatRelLV { baseHPRelLV: number; atkPhysicRelLV: number; atkMagicRelLV: number; defPhysicRelLV: number; defMagicRelLV: number }
export interface KimSpecialAbility { type: number; coolTime: number; value1: number; value2: number; value3: number; stringValue1: string }
export interface KimAttachedParticle { particleName: string; boneName: string }
export interface KimAttachedMesh { meshName: string; boneName: string; jiggle: boolean }
export interface KimPerUnit<T> { unitType: number; value: T }
export interface KimSlashTrace { kind: number; argb: number }
export interface KimColor { r: number; g: number; b: number; a: number }

/** `CX2Item::KItemFormatTemplet::EFlags`: bits 0..7 are booleans, the rest are 4-bit fields. */
export interface KimItemFlags {
  fashion: boolean;
  vested: boolean;
  canEnchant: boolean;
  canUseInventory: boolean;
  noEquip: boolean;
  isPcBang: boolean;
  canHyperMode: boolean;
  hideSetDesc: boolean;
  useType: number;
  useCondition: number;
  itemType: number;
  itemGrade: number;
  periodType: number;
  shopPriceType: number;
}

export function decodeItemFlags(flags: number): KimItemFlags {
  const bit = (n: number) => ((flags >>> n) & 1) === 1;
  const field = (pos: number) => (flags >>> pos) & 0xf;
  return {
    fashion: bit(0), vested: bit(1), canEnchant: bit(2), canUseInventory: bit(3), noEquip: bit(4), isPcBang: bit(5), canHyperMode: bit(6), hideSetDesc: bit(7),
    useType: field(8), useCondition: field(12), itemType: field(16), itemGrade: field(20), periodType: field(24), shopPriceType: field(28),
  };
}

/** `GetNameColor_` (32B85450): the colour tag of the item name, from the grade nibble of the flags. */
export function itemNameColor(flags: number): string {
  switch ((flags >>> 20) & 0xf) {
    case 1: return "#CFFCC99";
    case 2: return "#CFF00FF";
    case 3: return "#CFFFF00";
    case 5: return "#C888888";
    default: return "#CFFFFFF";
  }
}

export interface KimItem {
  id: number;
  flags: number;
  flags2: number;
  itemLevel: number;
  quantity: number;
  repairED: number;
  repairVP: number;
  price: number;
  pricePvPPoint: number;
  setID: number;
  addMaxMP: number;
  name: string;
  description: string;
  descriptionInShop: string;
  attachFrameNames: string[];
  modelNames: string[];
  textureChangeXETName: string;
  aniXETName: string;
  aniName: string;
  shopImage: string;
  dropViewer: string;
  descriptionInSkillNote: string;
  stat: KimStat;
  buffFactorIndices: number[];
  specialAbilities: KimSpecialAbility[];
  socketOptions: number[];
  attachedParticles: KimAttachedParticle[];
  attachedMeshes: KimAttachedMesh[];
  /** value `null`: offset 0 in the file (the exe then answers its default vector) */
  frameOffsets: Array<KimPerUnit<KimVec3 | null>>;
  renderScales: Array<KimPerUnit<KimVec3 | null>>;
  renderRotates: Array<KimPerUnit<KimVec3 | null>>;
  commonItemModelNames: Array<KimPerUnit<string>>;
  commonItemXETNames: Array<KimPerUnit<string>>;
  slashTraces: KimSlashTrace[];
  randomSocketOptions: number[];
  statRelLV: KimStatRelLV;
  endurance: number;
  enduranceDamageMin: number;
  enduranceDamageMax: number;
  summonNpcID: number;
  buyPvpRankCondition: number;
  useLevel: number;
  unitType: number;
  unitClass: number;
  buffID: number;
  eqipPosition: number;
  coolTime: number;
  maxSealCount: number;
  maxAttribEnchantCount: number;
  attributeLevel: number;
}

export interface KimSetItem {
  setID: number;
  maxLevel: number;
  setName: string;
  itemIDs: number[];
  /** sorted by `needPartsNum`; the options a set gives for k equipped parts are those of the last needPartsNum <= k */
  needPartsNumAndOptions: Array<{ needPartsNum: number; option: number }>;
}

export interface KimOpenOptions {
  /** called for every byte range the decoder reads (offset, length); the verify tool uses it to measure how much of the file is understood */
  onRead?: (offset: number, length: number) => void;
  /** called for every non-empty string that is decoded: offset, the u16 length word, the text read up to the NUL */
  onString?: (offset: number, lengthWord: number, text: string) => void;
}

export class Kim {
  readonly numItems: number;
  readonly numSetIDs: number;
  private readonly dv: DataView;
  private readonly size: number;
  private readonly idsAt = KIM_HEADER_SIZE;
  private readonly templetsAt: number;
  private readonly setIdsAt: number;
  private readonly setDataAt: number;
  private readonly onRead: ((offset: number, length: number) => void) | undefined;
  private readonly onString: ((offset: number, lengthWord: number, text: string) => void) | undefined;

  private constructor(readonly bytes: Uint8Array, opts: KimOpenOptions) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.size = bytes.length;
    this.onRead = opts.onRead;
    this.onString = opts.onString;
    this.numItems = this.dv.getUint32(8, true);
    this.numSetIDs = this.dv.getUint32(12, true);
    this.templetsAt = this.idsAt + 4 * this.numItems;
    this.setIdsAt = this.templetsAt + KIM_TEMPLET_SIZE * this.numItems;
    this.setDataAt = this.setIdsAt + 4 * this.numSetIDs;
    const fixedEnd = this.setDataAt + KIM_SET_ENTRY_SIZE * this.numSetIDs;
    if (fixedEnd > this.size) throw new KimFormatError(`kim: tables need ${fixedEnd} bytes, file has ${this.size}`);
  }

  /** `DoMemoryNotEncrypt`: magic, version and the minimum size `192 * numItems | 0x10`; anything else is rejected. */
  static open(bytes: Uint8Array, opts: KimOpenOptions = {}): Kim {
    if (bytes.length < 0x10) throw new KimFormatError("kim: shorter than the 16-byte header");
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== KIM_MAGIC) throw new KimFormatError("kim: bad magic");
    if (dv.getUint32(4, true) !== KIM_VERSION) throw new KimFormatError(`kim: unsupported version ${dv.getUint32(4, true)}`);
    const need = (192 * dv.getUint32(8, true)) | 0x10;
    if (bytes.length < need) throw new KimFormatError(`kim: ${bytes.length} bytes, the header promises at least ${need}`);
    opts.onRead?.(0, KIM_HEADER_SIZE);
    return new Kim(bytes, opts);
  }

  /** the item ids in file order (ascending) */
  itemIds(): number[] {
    this.onRead?.(this.idsAt, 4 * this.numItems);
    const out = new Array<number>(this.numItems);
    for (let i = 0; i < this.numItems; i++) out[i] = this.dv.getUint32(this.idsAt + 4 * i, true);
    return out;
  }

  setIds(): number[] {
    this.onRead?.(this.setIdsAt, 4 * this.numSetIDs);
    const out = new Array<number>(this.numSetIDs);
    for (let i = 0; i < this.numSetIDs; i++) out[i] = this.dv.getUint32(this.setIdsAt + 4 * i, true);
    return out;
  }

  /** `std::lower_bound` over the id table, then an equality test: the index of `id`, or -1 */
  indexOfItem(id: number): number {
    return this.search(this.idsAt, this.numItems, id);
  }

  indexOfSet(id: number): number {
    return this.search(this.setIdsAt, this.numSetIDs, id);
  }

  private search(at: number, n: number, id: number): number {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.dv.getUint32(at + 4 * mid, true) < id >>> 0) lo = mid + 1;
      else hi = mid;
    }
    return lo < n && this.dv.getUint32(at + 4 * lo, true) === id >>> 0 ? lo : -1;
  }

  /** `CX2ItemManager::GetItemTemplet`-style lookup by id */
  getItem(id: number): KimItem | undefined {
    const i = this.indexOfItem(id);
    return i < 0 ? undefined : this.itemAt(i);
  }

  getSet(id: number): KimSetItem | undefined {
    const i = this.indexOfSet(id);
    return i < 0 ? undefined : this.setAt(i);
  }

  // ---- low level -------------------------------------------------------------------------------------------------------

  private check(at: number, len: number, what: string): void {
    if (at < 0 || len < 0 || at + len > this.size) throw new KimFormatError(`kim: ${what} at ${at} (+${len}) is outside the ${this.size}-byte file`);
    this.onRead?.(at, len);
  }

  private u32(at: number): number { return this.dv.getUint32(at, true); }
  private i32(at: number): number { return this.dv.getInt32(at, true); }
  private f32(at: number): number { return this.dv.getFloat32(at, true); }

  /** `GetWideString` and the per-field accessors: offset 0 or a zero length word read as the empty string; the text runs to the NUL. */
  string(offset: number): string {
    if (offset === 0) return "";
    this.check(offset, 2, "string length");
    const lengthWord = this.dv.getUint16(offset, true);
    if (lengthWord === 0) return "";
    let end = offset + 2;
    while (true) {
      if (end + 2 > this.size) throw new KimFormatError(`kim: string at ${offset} is not terminated`);
      if (this.dv.getUint16(end, true) === 0) break;
      end += 2;
    }
    this.check(offset, end + 2 - offset, "string");
    let s = "";
    for (let p = offset + 2; p < end; p += 2) s += String.fromCharCode(this.dv.getUint16(p, true));
    this.onString?.(offset, lengthWord, s);
    return s;
  }

  private vec3(offset: number): KimVec3 | null {
    if (offset === 0) return null;
    this.check(offset, 12, "vector");
    return { x: this.f32(offset), y: this.f32(offset + 4), z: this.f32(offset + 8) };
  }

  private intList(offset: number): number[] {
    if (offset === 0) return [];
    this.check(offset, 4, "list count");
    const n = this.u32(offset);
    this.check(offset, 4 + 4 * n, "int list");
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = this.i32(offset + 4 + 4 * i);
    return out;
  }

  private pairs<T>(at: number, n: number, make: (a: number, b: number) => T): T[] {
    this.check(at, 8 * n, "pair array");
    const out = new Array<T>(n);
    for (let i = 0; i < n; i++) out[i] = make(this.u32(at + 8 * i), this.u32(at + 8 * i + 4));
    return out;
  }

  // ---- items -----------------------------------------------------------------------------------------------------------

  itemAt(index: number): KimItem {
    if (!(index >= 0 && index < this.numItems)) throw new KimFormatError(`kim: item index ${index} out of range`);
    const t = this.templetsAt + KIM_TEMPLET_SIZE * index;
    this.check(t, KIM_TEMPLET_SIZE, "item templet");
    const w = (n: number) => this.u32(t + 4 * n);
    const strs = (from: number, n: number) => Array.from({ length: n }, (_, k) => this.string(w(from + k)));
    const numFrameOffsets = this.dv.getUint8(t + 182);
    const numRenderScales = this.dv.getUint8(t + 183);
    const numRenderRotates = this.dv.getUint8(t + 184);
    const numModelNames = this.dv.getUint8(t + 185);
    const numXETNames = this.dv.getUint8(t + 186);
    const numSlashTraces = this.dv.getUint8(t + 187);

    // extra block: six arrays of 8-byte entries back to back
    const extra = w(38);
    let frameOffsets: Array<KimPerUnit<KimVec3 | null>> = [];
    let renderScales: Array<KimPerUnit<KimVec3 | null>> = [];
    let renderRotates: Array<KimPerUnit<KimVec3 | null>> = [];
    let commonItemModelNames: Array<KimPerUnit<string>> = [];
    let commonItemXETNames: Array<KimPerUnit<string>> = [];
    let slashTraces: KimSlashTrace[] = [];
    if (extra !== 0) {
      let at = extra;
      const vecs = (n: number) => { const r = this.pairs(at, n, (u, off) => ({ unitType: u, value: this.vec3(off) })); at += 8 * n; return r; };
      const names = (n: number) => { const r = this.pairs(at, n, (u, off) => ({ unitType: u, value: this.string(off) })); at += 8 * n; return r; };
      frameOffsets = vecs(numFrameOffsets);
      renderScales = vecs(numRenderScales);
      renderRotates = vecs(numRenderRotates);
      commonItemModelNames = names(numModelNames);
      commonItemXETNames = names(numXETNames);
      slashTraces = this.pairs(at, numSlashTraces, (kind, argb) => ({ kind, argb }));
    }

    const statAt = w(32);
    let stat: KimStat = { baseHP: 0, atkPhysic: 0, atkMagic: 0, defPhysic: 0, defMagic: 0 };
    if (statAt !== 0) {
      this.check(statAt, 20, "stat data");
      stat = { baseHP: this.f32(statAt), atkPhysic: this.f32(statAt + 4), atkMagic: this.f32(statAt + 8), defPhysic: this.f32(statAt + 12), defMagic: this.f32(statAt + 16) };
    }
    const relAt = w(40);
    let statRelLV: KimStatRelLV = { baseHPRelLV: 0, atkPhysicRelLV: 0, atkMagicRelLV: 0, defPhysicRelLV: 0, defMagicRelLV: 0 };
    if (relAt !== 0) {
      this.check(relAt, 5, "stat relation level");
      statRelLV = { baseHPRelLV: this.dv.getUint8(relAt), atkPhysicRelLV: this.dv.getUint8(relAt + 1), atkMagicRelLV: this.dv.getUint8(relAt + 2), defPhysicRelLV: this.dv.getUint8(relAt + 3), defMagicRelLV: this.dv.getUint8(relAt + 4) };
    }
    const buffAt = w(33);
    const buffFactorIndices: number[] = [];
    if (buffAt !== 0) {
      this.check(buffAt, 2, "buff factor count");
      const n = this.dv.getUint16(buffAt, true);
      this.check(buffAt, 2 + 2 * n, "buff factor indices");
      for (let i = 0; i < n; i++) buffFactorIndices.push(this.dv.getUint16(buffAt + 2 + 2 * i, true));
    }
    const abilityAt = w(34);
    const specialAbilities: KimSpecialAbility[] = [];
    if (abilityAt !== 0) {
      this.check(abilityAt, 4, "special ability count");
      const n = this.u32(abilityAt);
      this.check(abilityAt, 4 + 24 * n, "special abilities");
      for (let i = 0; i < n; i++) {
        const a = abilityAt + 4 + 24 * i;
        specialAbilities.push({ type: this.u32(a), coolTime: this.i32(a + 4), value1: this.i32(a + 8), value2: this.i32(a + 12), value3: this.i32(a + 16), stringValue1: this.string(this.u32(a + 20)) });
      }
    }
    const particleAt = w(36);
    let attachedParticles: KimAttachedParticle[] = [];
    if (particleAt !== 0) {
      this.check(particleAt, 4, "attached particle count");
      attachedParticles = this.pairs(particleAt + 4, this.u32(particleAt), (n, b) => ({ particleName: this.string(n), boneName: this.string(b) }));
    }
    const meshAt = w(37);
    let attachedMeshes: KimAttachedMesh[] = [];
    if (meshAt !== 0) {
      this.check(meshAt, 4, "attached mesh count");
      attachedMeshes = this.pairs(meshAt + 4, this.u32(meshAt), (n, b) => ({ meshName: this.string(n & 0x7fffffff), boneName: this.string(b), jiggle: (n & 0x80000000) !== 0 }));
    }

    return {
      id: w(0), flags: w(1), flags2: w(2), itemLevel: this.i32(t + 12), quantity: this.i32(t + 16), repairED: this.f32(t + 20), repairVP: this.i32(t + 24),
      price: this.i32(t + 28), pricePvPPoint: this.i32(t + 32), setID: this.i32(t + 36), addMaxMP: this.f32(t + 40),
      name: this.string(w(11)), description: this.string(w(12)), descriptionInShop: this.string(w(13)),
      attachFrameNames: strs(14, 6), modelNames: strs(20, 6),
      textureChangeXETName: this.string(w(26)), aniXETName: this.string(w(27)), aniName: this.string(w(28)), shopImage: this.string(w(29)),
      dropViewer: this.string(w(30)), descriptionInSkillNote: this.string(w(31)),
      stat, buffFactorIndices, specialAbilities, socketOptions: this.intList(w(35)), attachedParticles, attachedMeshes,
      frameOffsets, renderScales, renderRotates, commonItemModelNames, commonItemXETNames, slashTraces,
      randomSocketOptions: this.intList(w(39)), statRelLV,
      endurance: this.dv.getInt16(t + 164, true), enduranceDamageMin: this.dv.getInt16(t + 166, true), enduranceDamageMax: this.dv.getInt16(t + 168, true),
      summonNpcID: this.dv.getUint16(t + 170, true),
      buyPvpRankCondition: this.dv.getUint8(t + 172), useLevel: this.dv.getUint8(t + 173), unitType: this.dv.getUint8(t + 174), unitClass: this.dv.getUint8(t + 175),
      buffID: this.dv.getUint8(t + 176), eqipPosition: this.dv.getUint8(t + 177), coolTime: this.dv.getUint8(t + 178), maxSealCount: this.dv.getUint8(t + 179),
      maxAttribEnchantCount: this.dv.getUint8(t + 180), attributeLevel: this.dv.getUint8(t + 181),
    };
  }

  // ---- sets ------------------------------------------------------------------------------------------------------------

  setAt(index: number): KimSetItem {
    if (!(index >= 0 && index < this.numSetIDs)) throw new KimFormatError(`kim: set index ${index} out of range`);
    const e = this.setDataAt + KIM_SET_ENTRY_SIZE * index;
    this.check(e, KIM_SET_ENTRY_SIZE, "set item data");
    const needAt = this.u32(e + 16);
    const need: Array<{ needPartsNum: number; option: number }> = [];
    if (needAt !== 0) {
      this.check(needAt, 4, "set need-parts count");
      const n = this.u32(needAt);
      this.check(needAt, 4 + 8 * n, "set need-parts options");
      for (let i = 0; i < n; i++) need.push({ needPartsNum: this.u32(needAt + 4 + 8 * i), option: this.i32(needAt + 8 + 8 * i) });
    }
    return { setID: this.u32(e), maxLevel: this.i32(e + 4), setName: this.string(this.u32(e + 8)), itemIDs: this.intList(this.u32(e + 12)).map((v) => v >>> 0), needPartsNumAndOptions: need };
  }
}

/**
 * `KItemFormatSetItemData::GetSetItemOptions` (32B851B0): `upper_bound` on needPartsNum <= equipped, then every entry from the first
 * one with the same needPartsNum as the last qualifying entry (`lower_bound`) up to `upper`: the options of the greatest needPartsNum
 * not above `equipped`. The exe's two binary searches are reproduced as they are, so an unsorted table behaves the same.
 */
export function setItemOptions(set: KimSetItem, equipped: number): number[] {
  const list = set.needPartsNumAndOptions;
  let lo = 0;
  let n = list.length;
  while (n > 0) {
    const half = n >>> 1;
    if (equipped >= list[lo + half]!.needPartsNum) { lo += half + 1; n -= half + 1; } else n = half;
  }
  const upper = lo;
  if (upper === 0) return [];
  const top = list[upper - 1]!.needPartsNum;
  let first = 0;
  let count = upper;
  while (count > 0) {
    const half = count >>> 1;
    if (list[first + half]!.needPartsNum >= top) count = half;
    else { first += half + 1; count -= half + 1; }
  }
  return list.slice(first, upper).map((e) => e.option);
}

// ---- per-unit lookups (the exe scans the entries linearly; the first match wins) ---------------------------------------------

function pick<T>(list: Array<KimPerUnit<T>>, unitType: number): KimPerUnit<T> | undefined {
  return list.find((e) => e.unitType === unitType);
}

/** `GetFrameOffset` / `GetRenderRotate`: zero vector when absent */
export function frameOffsetFor(item: KimItem, unitType: number): KimVec3 {
  return pick(item.frameOffsets, unitType)?.value ?? { x: 0, y: 0, z: 0 };
}
export function renderRotateFor(item: KimItem, unitType: number): KimVec3 {
  return pick(item.renderRotates, unitType)?.value ?? { x: 0, y: 0, z: 0 };
}
/** `GetRenderScale`: (1,1,1) when absent */
export function renderScaleFor(item: KimItem, unitType: number): KimVec3 {
  return pick(item.renderScales, unitType)?.value ?? { x: 1, y: 1, z: 1 };
}
export function commonItemModelNameFor(item: KimItem, unitType: number): string {
  return pick(item.commonItemModelNames, unitType)?.value ?? "";
}
export function commonItemXETNameFor(item: KimItem, unitType: number): string {
  return pick(item.commonItemXETNames, unitType)?.value ?? "";
}

/** `GetSlashTraceColors` (32B85CB0): per-unit defaults, overridden by the item's own entries (kind 0 body, 1 tip, 2 hyper, 3 hyper tip; ARGB). */
export function slashTraceColors(item: KimItem, unitType: number): { color: KimColor; tip: KimColor; hyper: KimColor; hyperTip: KimColor } {
  const f = Math.fround;
  let color: KimColor;
  let tip: KimColor;
  if (unitType === UNIT_TYPE.ARA) {
    color = { r: f(0.8000001), g: f(0.6), b: f(0.20000002), a: 1 };
    tip = { r: f(0.8000001), g: f(0.6), b: f(0.20000002), a: 1 };
  } else if (unitType === UNIT_TYPE.ELESIS) {
    color = { r: f(0.9803922), g: f(0.47058827), b: f(0.098039225), a: 1 };
    tip = { r: f(0.9803922), g: f(0.47058827), b: f(0.098039225), a: 1 };
  } else {
    color = { r: f(0.33333334), g: f(0.33333334), b: 1, a: f(0.8000001) };
    tip = { r: f(0.33333334), g: f(0.33333334), b: 1, a: f(0.8000001) };
  }
  const hyper: KimColor = { r: 1, g: f(0.20000002), b: f(0.20000002), a: f(0.8000001) };
  const hyperTip: KimColor = { r: 1, g: f(0.20000002), b: f(0.20000002), a: 1 };
  const argb = (v: number): KimColor => {
    const k = f(0.003921569);
    return { r: f(((v >>> 16) & 0xff) * k), g: f(((v >>> 8) & 0xff) * k), b: f((v & 0xff) * k), a: f((v >>> 24) * k) };
  };
  for (const s of item.slashTraces) {
    if (s.kind === 0) color = argb(s.argb);
    else if (s.kind === 1) tip = argb(s.argb);
    else if (s.kind === 2) Object.assign(hyper, argb(s.argb));
    else if (s.kind === 3) Object.assign(hyperTip, argb(s.argb));
  }
  return { color, tip, hyper, hyperTip };
}
