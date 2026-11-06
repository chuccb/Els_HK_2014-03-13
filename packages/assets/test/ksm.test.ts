import { describe, expect, test } from "bun:test";
import { fvfVertexSize, KFormatError, parseKac, parseKme, parseKsm } from "../src/index.ts";

/** Little-endian byte builder with absolute patching. */
class W {
  readonly b: number[] = [];
  get pos(): number { return this.b.length; }
  u8(v: number): this { this.b.push(v & 255); return this; }
  u32(v: number): this { for (let i = 0; i < 4; i++) this.b.push((v >>> (8 * i)) & 255); return this; }
  i32(v: number): this { return this.u32(v >>> 0); }
  f32(v: number): this { const t = new DataView(new ArrayBuffer(4)); t.setFloat32(0, v, true); for (let i = 0; i < 4; i++) this.b.push(t.getUint8(i)); return this; }
  f64(v: number): this { const t = new DataView(new ArrayBuffer(8)); t.setFloat64(0, v, true); for (let i = 0; i < 8; i++) this.b.push(t.getUint8(i)); return this; }
  str(s: string): number { const at = this.pos; this.u32(s.length); for (const c of s) this.u8(c.charCodeAt(0)); return at; }
  patch(at: number, v: number): void { for (let i = 0; i < 4; i++) this.b[at + i] = (v >>> (8 * i)) & 255; }
  pad(n: number): this { while (this.pos % n) this.u8(0); return this; }
  bytes(): Uint8Array { return Uint8Array.from(this.b); }
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function material(w: W, texOffset: number, diffuse = 1): void {
  for (const c of [diffuse, 0.5, 0.25, 1]) w.f32(c); // diffuse
  for (const c of [0.1, 0.2, 0.3, 1]) w.f32(c); // ambient
  for (const c of [0, 0, 0, 1]) w.f32(c); // specular
  for (const c of [0, 0, 0, 0]) w.f32(c); // emissive
  w.f32(8); // power
  w.u32(texOffset);
}

function buildKme(mutate?: (w: W) => void): Uint8Array {
  const w = new W();
  w.u32(0x20454d4b).u32(512).u32(338).u32(0); // magic, version, FVF, options
  const patchAt = w.pos;
  for (let i = 0; i < 7; i++) w.u32(0); // numMat, offMat, numVert, offVert, numFace, offIdx, offAttr
  w.f32(1).f32(2).f32(3).f32(4); // center, radius
  const tex = w.str("floor.tga");
  const offMat = w.pos; material(w, tex);
  const offVert = w.pos;
  for (const v of [[0, 0, 0], [1, 0, 0], [0, 1, 0]]) { for (const c of v) w.f32(c); w.f32(0).f32(0).f32(1); w.u32(0xffffffff); w.f32(v[0]!).f32(v[1]!); }
  const offIdx = w.pos; w.b.push(0, 0, 1, 0, 2, 0); w.pad(4);
  const offAttr = w.pos; w.u32(0);
  [1, offMat, 3, offVert, 1, offIdx, offAttr].forEach((v, i) => w.patch(patchAt + 4 * i, v));
  mutate?.(w);
  return w.bytes();
}

describe("fvfVertexSize", () => {
  test("common formats", () => {
    expect(fvfVertexSize(338)).toBe(36); // XYZ | NORMAL | DIFFUSE | TEX1
    expect(fvfVertexSize(274)).toBe(32); // XYZ | NORMAL | TEX1
    expect(fvfVertexSize(18)).toBe(24); // XYZ | NORMAL
    expect(fvfVertexSize(0x144)).toBe(28); // XYZRHW | DIFFUSE | TEX1
    expect(fvfVertexSize(0x0c | 0x10 | 0x200)).toBe(28 + 12 + 16); // XYZB4 | NORMAL | TEX2
    expect(fvfVertexSize(0x102 | (1 << 16))).toBe(12 + 12); // XYZ | TEX1 with a 3-float coordinate set
  });
});

describe("KME", () => {
  test("decodes header, material, geometry and strings", () => {
    const m = parseKme(buildKme());
    expect(m.fvf).toBe(338);
    expect(m.vertexCount).toBe(3);
    expect(m.vertexStride).toBe(36);
    expect(m.vertices.length).toBe(108);
    expect(m.faceCount).toBe(1);
    expect([...m.indices]).toEqual([0, 1, 2]);
    expect(m.indices).toBeInstanceOf(Uint16Array);
    expect([...m.attributes]).toEqual([0]);
    expect(m.center).toEqual([1, 2, 3]);
    expect(m.radius).toBe(4);
    expect(m.materials).toHaveLength(1);
    expect(m.materials[0]!.texture).toBe("floor.tga");
    expect(m.materials[0]!.diffuse).toEqual([1, 0.5, 0.25, 1]);
    expect(m.materials[0]!.power).toBe(8);
  });

  test("rejects what the exe rejects", () => {
    const base = buildKme();
    const bad = (mut: (b: Uint8Array) => void): void => { const c = base.slice(); mut(c); expect(() => parseKme(c)).toThrow(KFormatError); };
    bad((b) => { b[0] = 0; }); // magic
    bad((b) => { b[4] = 1; }); // version
    bad((b) => { b[9] = 0; }); // FVF != 338
    bad((b) => { b[16] = 0; }); // no materials
    bad((b) => { b[28] = 0; b[29] = 0; }); // no vertex offset
    bad((b) => { b[40] = 0; b[41] = 0; b[42] = 0; b[43] = 0; }); // no attribute table
    bad((b) => { b[24] = 0xff; b[25] = 0xff; }); // vertex count beyond the file
    expect(() => parseKme(base.subarray(0, 0x20))).toThrow(KFormatError);
  });

  test("32-bit indices when options bit 0 is set", () => {
    const w = buildKme();
    // rebuild with wide indices: easiest is to patch options and append a wide index table
    const c = new W();
    for (const x of w) c.u8(x);
    c.b[12] = 1;
    const offIdx = c.pos; c.u32(2).u32(1).u32(0);
    c.patch(36, offIdx);
    const m = parseKme(c.bytes());
    expect([...m.indices]).toEqual([2, 1, 0]);
    expect(m.indices).toBeInstanceOf(Uint32Array);
  });
});

/** KAC block with one keyframed set; `animations` = per animation {frame, keys: [{time, flags, payload floats}]}. */
function buildKac(frameIndex: number, keys: Array<{ time: number; flags: number; data: number[] }>): W {
  const w = new W();
  w.u32(0x2043414b).u32(0x100).u32(1).u32(0); // magic, version, one set, offset patched below
  const setAt = w.pos;
  w.patch(12, setAt);
  const name = 0;
  w.u32(name).u32(0).f64(4800).u32(0); // KACAnimationSet: name offset (patched), type 0, ticks/s, playback
  w.u32(1); // numAnimations
  const sizeAt = w.pos; w.u32(0);
  const animStart = w.pos;
  w.i32(frameIndex).u32(keys.length);
  for (const k of keys) w.f32(k.time).u8(k.flags);
  for (const k of keys) for (const f of k.data) w.f32(f);
  w.patch(sizeAt, w.pos - animStart);
  w.patch(setAt, w.str("Idle"));
  return w;
}

describe("KAC / UnpackKeys", () => {
  test("flag semantics: carried values, bit 7 suppresses a channel", () => {
    const kac = buildKac(0, [
      { time: 0, flags: 0x7f, data: [2, 3, 4, 5, 6, 7, 0, 0, 0, 1] }, // scale (2,3,4) translation (5,6,7) rotation identity
      { time: 10, flags: 0xc0, data: [0.5, 0.5, 0.5, 0.5] }, // bit 7 + rotation: only a rotation key
      { time: 20, flags: 0x00, data: [] }, // nothing present, bit 7 clear: every channel repeats its last value
      { time: 30, flags: 0x88, data: [9] }, // bit 7 + translation x: a translation key only (0x87 and 0xC0 groups are 0x80 -> no scale, no rotation)
    ]);
    const k = parseKac(kac.bytes(), 1);
    expect(k.sets).toHaveLength(1);
    const s = k.sets[0]!;
    expect(s.name).toBe("Idle");
    expect(s.kind).toBe("keyframed");
    expect(s.ticksPerSecond).toBe(4800);
    expect(s.playbackType).toBe(0);
    const a = s.animations[0]!;
    expect(a.scales.map((x) => x.time)).toEqual([0, 20]);
    expect(a.scales[0]!.value).toEqual([2, 3, 4]);
    expect(a.scales[1]!.value).toEqual([2, 3, 4]);
    expect(a.translations.map((x) => x.time)).toEqual([0, 20, 30]);
    expect(a.translations[2]!.value).toEqual([9, 6, 7]);
    expect(a.rotations.map((x) => x.time)).toEqual([0, 10, 20]);
    expect(a.rotations[1]!.value).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(a.rotations[2]!.value).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  test("defaults before the first component: unit scale, zero translation, identity rotation", () => {
    const k = parseKac(buildKac(0, [{ time: 1, flags: 0x00, data: [] }]).bytes(), 1);
    const a = k.sets[0]!.animations[0]!;
    expect(a.scales[0]!.value).toEqual([1, 1, 1]);
    expect(a.translations[0]!.value).toEqual([0, 0, 0]);
    expect(a.rotations[0]!.value).toEqual([0, 0, 0, 1]);
  });

  test("payload must be consumed exactly; frame index must exist", () => {
    expect(() => parseKac(buildKac(0, [{ time: 0, flags: 0x01, data: [1, 2] }]).bytes(), 1)).toThrow(KFormatError);
    expect(() => parseKac(buildKac(0, [{ time: 0, flags: 0x07, data: [1, 2] }]).bytes(), 1)).toThrow(KFormatError);
    expect(() => parseKac(buildKac(3, [{ time: 0, flags: 0, data: [] }]).bytes(), 2)).toThrow(KFormatError);
    const w = buildKac(0, [{ time: 0, flags: 0, data: [] }]);
    w.b[0] = 0;
    expect(() => parseKac(w.bytes(), 1)).toThrow(KFormatError);
  });
});

function buildKsm(opts: { siblingOfRoot?: boolean; badBoneFrame?: boolean } = {}): Uint8Array {
  const w = new W();
  w.u32(0x204d534b).u32(512);
  const acAt = w.pos; w.u32(0);
  w.f32(0).f32(1).f32(2).f32(5).u32(3); // center, max radius, numFrames
  const framesAt = w.pos;
  for (let i = 0; i < 3; i++) { w.u32(0); for (const v of IDENTITY) w.f32(v); w.f32(0).u32(0).i32(-1).i32(-1); }
  const frame = (i: number) => framesAt + 84 * i;
  // tree: 0 -> child 1; 1 -> sibling 2
  w.patch(frame(0) + 80, 1);
  w.patch(frame(1) + 76, opts.siblingOfRoot ? 0 : 2);
  w.patch(frame(0), w.str("Root"));
  w.patch(frame(1), w.str("Bip01"));
  // mesh container on frame 1
  const tex = w.str("skin.tga");
  const offMat = w.pos; material(w, tex);
  const offVert = w.pos;
  for (let i = 0; i < 3; i++) { for (const c of [i, 0, 0]) w.f32(c); w.f32(0).f32(0).f32(1); w.f32(i).f32(0); }
  const offIdx = w.pos; w.b.push(0, 0, 1, 0, 2, 0); w.pad(4);
  const offAttr = w.pos; w.u32(0);
  const offInf = w.pos; w.u32(0).u32(2).f32(1).f32(0.5);
  const offBones = w.pos;
  for (const v of IDENTITY) w.f32(v);
  w.i32(opts.badBoneFrame ? 9 : 2).u32(2).u32(offInf);
  const bodyName = w.str("Body");
  const mc = w.pos;
  w.u32(bodyName).u32(274).u32(0).u32(1).u32(offMat).u32(3).u32(offVert).u32(1).u32(offIdx).u32(offAttr).u32(1).u32(offBones).u32(7).u32(0);
  w.patch(frame(1) + 72, mc);
  const kac = buildKac(2, [{ time: 0, flags: 0x08, data: [1] }, { time: 4800, flags: 0x08, data: [2] }]);
  const ac = w.pos;
  for (const x of kac.b) w.u8(x);
  // offsets inside the KAC block are relative to the block, which they already are
  w.patch(acAt, ac);
  return w.bytes();
}

describe("KSM", () => {
  test("frames, tree, mesh container, bones and embedded animation", () => {
    const k = parseKsm(buildKsm());
    expect(k.frames).toHaveLength(3);
    expect(k.frames.map((f) => f.name)).toEqual(["Root", "Bip01", null]);
    expect(k.frames.map((f) => [f.sibling, f.firstChild])).toEqual([[-1, 1], [2, -1], [-1, -1]]);
    expect(k.center).toEqual([0, 1, 2]);
    expect(k.maxBoundingRadius).toBe(5);
    expect(k.frames[0]!.meshContainer).toBeNull();
    const c = k.frames[1]!.meshContainer!;
    expect(c.name).toBe("Body");
    expect(c.fvf).toBe(274);
    expect(c.vertexStride).toBe(32);
    expect(c.vertexCount).toBe(3);
    expect(c.materials[0]!.texture).toBe("skin.tga");
    expect(c.numPaletteEntries).toBe(7);
    expect(c.bones).toHaveLength(1);
    expect(c.bones[0]!.frameIndex).toBe(2);
    expect([...c.bones[0]!.vertexIndices]).toEqual([0, 2]);
    expect([...c.bones[0]!.weights]).toEqual([1, 0.5]);
    expect(k.animation!.sets[0]!.animations[0]!.frameIndex).toBe(2);
    expect(k.animation!.sets[0]!.animations[0]!.translations.map((t) => t.value[0])).toEqual([1, 2]);
  });

  test("frame tree must be a tree rooted at frame 0; bones must point at frames", () => {
    expect(() => parseKsm(buildKsm({ siblingOfRoot: true }))).toThrow(KFormatError);
    expect(() => parseKsm(buildKsm({ badBoneFrame: true }))).toThrow(KFormatError);
    const tooMany = buildKsm();
    tooMany[28] = 0; tooMany[29] = 1; // 256 frames
    expect(() => parseKsm(tooMany)).toThrow(/limit 255/);
  });
});
