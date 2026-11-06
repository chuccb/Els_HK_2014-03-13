import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { KomArchive, fileSource } from "@els/kom";
import {
  commonItemModelNameFor, commonItemXETNameFor, decodeItemFlags, frameOffsetFor, itemNameColor, Kim, KimFormatError, renderRotateFor, renderScaleFor,
  setItemOptions, slashTraceColors, UNIT_TYPE,
} from "../src/index.ts";

/** A tiny writer for KIM images: header, id table, templets, set tables, then a pool that the templets point into. */
class Image {
  pool: number[] = [];
  constructor(readonly poolStart: number) {}
  private align4() { while ((this.poolStart + this.pool.length) % 4 !== 0) this.pool.push(0); }
  private u32(v: number) { for (let i = 0; i < 4; i++) this.pool.push((v >>> (8 * i)) & 0xff); }
  private f32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); this.pool.push(...b); }
  str(s: string): number {
    if (s === "") return 0;
    const at = this.poolStart + this.pool.length;
    this.pool.push(s.length & 0xff, s.length >>> 8);
    for (const ch of s) this.pool.push(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >>> 8);
    this.pool.push(0, 0);
    this.align4();
    return at;
  }
  block(write: () => void): number { this.align4(); const at = this.poolStart + this.pool.length; write(); this.align4(); return at; }
  stat(a: number[]): number { return this.block(() => a.forEach((v) => this.f32(v))); }
  vec(x: number, y: number, z: number): number { return this.block(() => { this.f32(x); this.f32(y); this.f32(z); }); }
  ints(list: number[]): number { return this.block(() => { this.u32(list.length); list.forEach((v) => this.u32(v >>> 0)); }); }
  u16list(list: number[]): number { return this.block(() => { this.pool.push(list.length & 0xff, list.length >>> 8); list.forEach((v) => this.pool.push(v & 0xff, v >>> 8)); }); }
  raw(bytes: number[]): number { return this.block(() => this.pool.push(...bytes)); }
  words(list: number[]): number { return this.block(() => list.forEach((v) => this.u32(v >>> 0))); }
}

interface TempletSpec { id: number; words?: Record<number, number>; bytes?: Record<number, number>; shorts?: Record<number, number>; floats?: Record<number, number> }

function build(items: TempletSpec[], sets: Array<{ id: number; words: number[] }>, makePool: (img: Image) => void): Uint8Array {
  const n = items.length, s = sets.length;
  const poolStart = 16 + 192 * n + 24 * s;
  const img = new Image(poolStart);
  makePool(img);
  const out = new Uint8Array(poolStart + img.pool.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x204d494b, true); dv.setUint32(4, 4609, true); dv.setUint32(8, n, true); dv.setUint32(12, s, true);
  items.forEach((it, i) => dv.setUint32(16 + 4 * i, it.id, true));
  items.forEach((it, i) => {
    const t = 16 + 4 * n + 188 * i;
    dv.setUint32(t, it.id, true);
    for (const [k, v] of Object.entries(it.words ?? {})) dv.setUint32(t + 4 * Number(k), v >>> 0, true);
    for (const [k, v] of Object.entries(it.floats ?? {})) dv.setFloat32(t + 4 * Number(k), v, true);
    for (const [k, v] of Object.entries(it.shorts ?? {})) dv.setInt16(t + Number(k), v, true);
    for (const [k, v] of Object.entries(it.bytes ?? {})) dv.setUint8(t + Number(k), v);
  });
  const setIdsAt = 16 + 4 * n + 188 * n;
  sets.forEach((st, i) => dv.setUint32(setIdsAt + 4 * i, st.id, true));
  sets.forEach((st, i) => st.words.forEach((w, k) => dv.setUint32(setIdsAt + 4 * s + 20 * i + 4 * k, w >>> 0, true)));
  out.set(img.pool, poolStart);
  return out;
}

function sample(): Uint8Array {
  const itemA: TempletSpec = { id: 100, words: {}, floats: { 5: 12.5, 10: 3.25 }, shorts: { 164: -5, 166: 7, 168: 9, 170: 1234 }, bytes: {} };
  const itemB: TempletSpec = { id: 205 };
  const refs: Record<string, number> = {};
  return build([itemA, itemB], [{ id: 10, words: [10, 3, 0, 0, 0] }, { id: 20, words: [20, 1, 0, 0, 0] }], (img) => {
    const w = itemA.words!;
    w[1] = 0x00230001 | (2 << 8); w[2] = 0; w[3] = 15; w[4] = 99; w[6] = 40; w[7] = 3000; w[8] = 5; w[9] = 10;
    w[11] = img.str("Sword"); w[12] = img.str("A sharp sword"); w[13] = img.str("Shop text");
    w[14] = img.str("Bip01 R Hand"); w[20] = img.str("Mesh_Sword.X"); w[21] = img.str("Mesh_Sword2.X");
    w[26] = img.str("sword.xet"); w[27] = img.str("ani.xet"); w[28] = img.str("Wait"); w[29] = img.str("shop.tga"); w[30] = img.str("drop.tga"); w[31] = img.str("skill note");
    w[32] = img.stat([1, 2, 3, 4, 5]);
    w[33] = img.u16list([5, 6]);
    // special abilities: u32 n, then 24-byte entries
    w[34] = img.words([1, 3, 1000, 1, 2, 3, img.str("fx")]);
    w[35] = img.ints([7, 8, -9]);
    w[36] = img.words([1, img.str("Particle_A"), img.str("Bip01 Head")]);
    w[37] = img.words([2, img.str("MeshA.X"), img.str("Bip01 Spine"), (img.str("MeshB.X") | 0x80000000) >>> 0, img.str("Bip01 Pelvis")]);
    // extra: frameOffsets(1), renderScales(1), renderRotates(0), models(1), xets(1), slashTraces(2)
    const v1 = img.vec(1, 2, 3), v2 = img.vec(2, 2, 2), m = img.str("common.x"), x = img.str("common.xet");
    w[38] = img.words([UNIT_TYPE.ELSWORD, v1, UNIT_TYPE.ARA, v2, UNIT_TYPE.ARME, m, UNIT_TYPE.ARME, x, 0, 0xff102030, 3, 0x80ffffff]);
    w[39] = img.ints([1]);
    w[40] = img.raw([1, 2, 3, 4, 5]);
    Object.assign(itemA.bytes!, { 172: 11, 173: 12, 174: 1, 175: 3, 176: 4, 177: 5, 178: 6, 179: 7, 180: 8, 181: 9, 182: 1, 183: 1, 184: 0, 185: 1, 186: 1, 187: 2 });
    // set 10: name, item ids, need-parts options (needPartsNum, option)
    void refs;
    return;
  });
}

describe("Kim image", () => {
  test("header checks follow DoMemoryNotEncrypt", () => {
    const img = sample();
    expect(Kim.open(img).numItems).toBe(2);
    const bad = img.slice(); bad[0] = 0x4c;
    expect(() => Kim.open(bad)).toThrow(KimFormatError);
    const ver = img.slice(); ver[5] = 0x13; // 4609 is 01 12 00 00: byte 4 already is 0x01
    expect(() => Kim.open(ver)).toThrow(/version/);
    expect(() => Kim.open(img.subarray(0, 12))).toThrow(/16-byte/);
    expect(() => Kim.open(img.subarray(0, 300))).toThrow(/promises at least/);
  });

  test("lookup is lower_bound plus equality", () => {
    const kim = Kim.open(sample());
    expect(kim.itemIds()).toEqual([100, 205]);
    expect(kim.indexOfItem(100)).toBe(0);
    expect(kim.indexOfItem(205)).toBe(1);
    expect(kim.indexOfItem(101)).toBe(-1);
    expect(kim.indexOfItem(0)).toBe(-1);
    expect(kim.indexOfItem(0xffffffff)).toBe(-1);
    expect(kim.getItem(99)).toBeUndefined();
  });

  test("a fully populated templet", () => {
    const it = Kim.open(sample()).getItem(100)!;
    expect(it).toMatchObject({ id: 100, itemLevel: 15, quantity: 99, repairED: 12.5, repairVP: 40, price: 3000, pricePvPPoint: 5, setID: 10, addMaxMP: 3.25 });
    expect(it.name).toBe("Sword");
    expect(it.description).toBe("A sharp sword");
    expect(it.descriptionInShop).toBe("Shop text");
    expect(it.attachFrameNames).toEqual(["Bip01 R Hand", "", "", "", "", ""]);
    expect(it.modelNames).toEqual(["Mesh_Sword.X", "Mesh_Sword2.X", "", "", "", ""]);
    expect([it.textureChangeXETName, it.aniXETName, it.aniName, it.shopImage, it.dropViewer, it.descriptionInSkillNote]).toEqual(["sword.xet", "ani.xet", "Wait", "shop.tga", "drop.tga", "skill note"]);
    expect(it.stat).toEqual({ baseHP: 1, atkPhysic: 2, atkMagic: 3, defPhysic: 4, defMagic: 5 });
    expect(it.buffFactorIndices).toEqual([5, 6]);
    expect(it.specialAbilities).toEqual([{ type: 3, coolTime: 1000, value1: 1, value2: 2, value3: 3, stringValue1: "fx" }]);
    expect(it.socketOptions).toEqual([7, 8, -9]);
    expect(it.randomSocketOptions).toEqual([1]);
    expect(it.attachedParticles).toEqual([{ particleName: "Particle_A", boneName: "Bip01 Head" }]);
    expect(it.attachedMeshes).toEqual([{ meshName: "MeshA.X", boneName: "Bip01 Spine", jiggle: false }, { meshName: "MeshB.X", boneName: "Bip01 Pelvis", jiggle: true }]);
    expect(it.statRelLV).toEqual({ baseHPRelLV: 1, atkPhysicRelLV: 2, atkMagicRelLV: 3, defPhysicRelLV: 4, defMagicRelLV: 5 });
    expect([it.endurance, it.enduranceDamageMin, it.enduranceDamageMax, it.summonNpcID]).toEqual([-5, 7, 9, 1234]);
    expect([it.buyPvpRankCondition, it.useLevel, it.unitType, it.unitClass, it.buffID, it.eqipPosition, it.coolTime, it.maxSealCount, it.maxAttribEnchantCount, it.attributeLevel]).toEqual([11, 12, 1, 3, 4, 5, 6, 7, 8, 9]);
    expect(decodeItemFlags(it.flags)).toMatchObject({ fashion: true, vested: false, canEnchant: false, useType: 2, itemType: 3, itemGrade: 2 });
    expect(frameOffsetFor(it, UNIT_TYPE.ELSWORD)).toEqual({ x: 1, y: 2, z: 3 });
    expect(frameOffsetFor(it, UNIT_TYPE.LIRE)).toEqual({ x: 0, y: 0, z: 0 });
    expect(renderScaleFor(it, UNIT_TYPE.ARA)).toEqual({ x: 2, y: 2, z: 2 });
    expect(renderScaleFor(it, UNIT_TYPE.EVE)).toEqual({ x: 1, y: 1, z: 1 });
    expect(renderRotateFor(it, UNIT_TYPE.ARA)).toEqual({ x: 0, y: 0, z: 0 });
    expect(commonItemModelNameFor(it, UNIT_TYPE.ARME)).toBe("common.x");
    expect(commonItemXETNameFor(it, UNIT_TYPE.ARME)).toBe("common.xet");
    expect(commonItemModelNameFor(it, UNIT_TYPE.EVE)).toBe("");
  });

  test("absent blocks read as the exe's zero dummies", () => {
    const it = Kim.open(sample()).getItem(205)!;
    expect(it.name).toBe("");
    expect(it.stat).toEqual({ baseHP: 0, atkPhysic: 0, atkMagic: 0, defPhysic: 0, defMagic: 0 });
    expect([it.buffFactorIndices, it.specialAbilities, it.socketOptions, it.attachedParticles, it.attachedMeshes, it.slashTraces]).toEqual([[], [], [], [], [], []]);
    expect(it.modelNames).toEqual(["", "", "", "", "", ""]);
  });

  test("slash trace colours: per-unit defaults, then the item's ARGB overrides", () => {
    const it = Kim.open(sample()).getItem(100)!;
    const c = slashTraceColors(it, UNIT_TYPE.ELSWORD);
    expect(c.color.r).toBeCloseTo(0x10 / 255, 6);
    expect(c.color.g).toBeCloseTo(0x20 / 255, 6);
    expect(c.color.b).toBeCloseTo(0x30 / 255, 6);
    expect(c.color.a).toBe(Math.fround(255 * Math.fround(0.003921569)));
    expect(c.tip.r).toBe(Math.fround(0.33333334)); // default, no kind-1 entry
    expect(c.hyperTip.a).toBeCloseTo(0x80 / 255, 6); // kind 3 override
    const plain = slashTraceColors(Kim.open(sample()).getItem(205)!, UNIT_TYPE.ARA);
    expect(plain.color).toEqual({ r: Math.fround(0.8000001), g: Math.fround(0.6), b: Math.fround(0.20000002), a: 1 });
    expect(plain.hyperTip).toEqual({ r: 1, g: Math.fround(0.20000002), b: Math.fround(0.20000002), a: 1 });
  });

  test("name colour comes from the grade nibble", () => {
    expect(itemNameColor(0)).toBe("#CFFFFFF");
    expect(itemNameColor(1 << 20)).toBe("#CFFCC99");
    expect(itemNameColor(2 << 20)).toBe("#CFF00FF");
    expect(itemNameColor(3 << 20)).toBe("#CFFFF00");
    expect(itemNameColor(4 << 20)).toBe("#CFFFFFF");
    expect(itemNameColor(5 << 20)).toBe("#C888888");
  });

  test("offsets outside the file are reported, not read", () => {
    const img = sample();
    const dv = new DataView(img.buffer);
    dv.setUint32(16 + 8 + 188 * 0 + 4 * 11, 0xfffff0, true); // item 0's name offset
    const kim = Kim.open(img);
    expect(() => kim.itemAt(0)).toThrow(KimFormatError);
    expect(() => kim.itemAt(2)).toThrow(/out of range/);
  });
});

describe("Kim sets", () => {
  test("GetSetItemOptions selects the options of the greatest needPartsNum not above the equipped count", () => {
    const need = [[2, 111], [3, 222], [3, 333], [5, 444]];
    const set = { setID: 10, maxLevel: 3, setName: "S", itemIDs: [1, 2], needPartsNumAndOptions: need.map(([n, o]) => ({ needPartsNum: n!, option: o! })) };
    expect(setItemOptions(set, 0)).toEqual([]);
    expect(setItemOptions(set, 1)).toEqual([]);
    expect(setItemOptions(set, 2)).toEqual([111]);
    expect(setItemOptions(set, 3)).toEqual([222, 333]);
    expect(setItemOptions(set, 4)).toEqual([222, 333]);
    expect(setItemOptions(set, 9)).toEqual([444]);
    expect(setItemOptions({ ...set, needPartsNumAndOptions: [] }, 3)).toEqual([]);
  });

  test("a set entry is decoded from the 20-byte table and the pool", () => {
    const names: Record<string, number> = {};
    const bytes = build([{ id: 1 }], [{ id: 10, words: [0, 0, 0, 0, 0] }], (img) => {
      names.name = img.str("Set Name");
      names.ids = img.ints([1, 5, 7]);
      names.need = img.words([2, 2, 100, 4, 200]);
    });
    const dv = new DataView(bytes.buffer);
    const e = 16 + 4 + 188 + 4; // header, one id, one templet, one set id
    dv.setUint32(e, 10, true); dv.setInt32(e + 4, 4, true); dv.setUint32(e + 8, names.name!, true); dv.setUint32(e + 12, names.ids!, true); dv.setUint32(e + 16, names.need!, true);
    const kim = Kim.open(bytes);
    expect(kim.setIds()).toEqual([10]);
    expect(kim.getSet(10)).toEqual({ setID: 10, maxLevel: 4, setName: "Set Name", itemIDs: [1, 5, 7], needPartsNumAndOptions: [{ needPartsNum: 2, option: 100 }, { needPartsNum: 4, option: 200 }] });
    expect(kim.getSet(11)).toBeUndefined();
  });
});

describe("the shipped item.kim", () => {
  test("header and a few known items", async () => {
    const path = new URL("../../../data/data036.kom", import.meta.url).pathname;
    if (!existsSync(path)) return;
    const kom = await KomArchive.open(fileSource(path));
    const entry = kom.find("item.kim");
    if (!entry) return;
    const kim = Kim.open(await kom.read(entry));
    expect([kim.numItems, kim.numSetIDs]).toEqual([57106, 3811]);
    const sword = kim.getItem(100)!;
    expect(sword.name).toBe("(舊)破舊見習戰士長劍");
    expect(sword.price).toBe(3000);
    expect(sword.stat.atkPhysic).toBe(90);
    expect(sword.modelNames[0]).toBe("Mesh_Elsword_Ed_Weapon10.X");
    expect(kim.getItem(250003020)!.name).toBe("敏銳的狼手套 Ver.B");
    expect(kim.getItem(99)).toBeUndefined();
  });
});
