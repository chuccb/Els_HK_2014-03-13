/**
 * KOG's own mesh containers, read by the exe next to Direct3D's X-file loaders:
 *   "KME " static mesh      CKTDXDeviceXMesh::XMeshProxy::LoadKMEMesh              3296A880 (x2.exe.c L425711)
 *   "KSM " skinned mesh     CKTDXDeviceXSkinMesh::XSkinMeshProxy::LoadKSkinnedMesh 3296EBB0 (L429515)
 *                           CKTDXDeviceXSkinMesh::MultiAnimMC::ReadKSM             3296F7B0 (L430172)
 *   "KAC " animations       KTDXAnimationController::ReadFromMemory                32988150 (L448687)
 *                           ReadFromMemoryDeserializer                             32989F10 (L450334), UnpackKeys 3298A4E0 (L450680)
 * All three are flat little-endian files whose pointers are byte offsets from the start of the file (for KAC: from the start
 * of the KAC block, which a KSM embeds at `offsetAnimationController` up to the end of the file). Strings are `u32 length`
 * followed by that many bytes (no terminator). The exe converts them into D3DX objects (ID3DXMesh, ID3DXSkinInfo,
 * ID3DXKeyframedAnimationSet); this module only decodes the bytes. Every offset is range-checked like KMemoryDeserializer::AccessData.
 */

export class KFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KFormatError";
  }
}

export const KME_MAGIC = 0x20454d4b; // 'KME ' (little endian)
export const KSM_MAGIC = 0x204d534b; // 'KSM '
export const KAC_MAGIC = 0x2043414b; // 'KAC '

export type Vec3 = [number, number, number];
export type Color4 = [number, number, number, number];

export interface KMaterial {
  diffuse: Color4;
  ambient: Color4;
  specular: Color4;
  emissive: Color4;
  power: number;
  /** texture file name as stored (ANSI), null when the material has none */
  texture: string | null;
}

/** Raw mesh data as the exe copies it into the D3DX vertex / index / attribute buffers. */
export interface KMeshData {
  fvf: number;
  /** bytes per vertex implied by `fvf` (D3DXGetFVFVertexSize) */
  vertexStride: number;
  vertexCount: number;
  /** `vertexCount * vertexStride` bytes in FVF layout */
  vertices: Uint8Array;
  faceCount: number;
  /** 3 indices per face, 16 or 32 bit depending on `options & 1` */
  indices: Uint16Array | Uint32Array;
  /** one subset (material) id per face; empty when the file has no attribute table */
  attributes: Uint32Array;
  options: number;
  materials: KMaterial[];
}

export interface KmeMesh extends KMeshData {
  center: Vec3;
  radius: number;
}

export interface KsmBone {
  /** D3DXMATRIX, row-major (_11 _12 _13 _14 _21 ...) */
  offsetMatrix: Float32Array;
  frameIndex: number;
  vertexIndices: Uint32Array;
  weights: Float32Array;
}

export interface KsmMeshContainer extends KMeshData {
  name: string | null;
  bones: KsmBone[];
  numPaletteEntries: number;
}

export interface KsmFrame {
  name: string | null;
  /** D3DXMATRIX, row-major */
  matrix: Float32Array;
  boundingRadius: number;
  /** index of the next sibling frame or -1 */
  sibling: number;
  /** index of the first child frame or -1 */
  firstChild: number;
  meshContainer: KsmMeshContainer | null;
}

export interface KacKeyVec3 { time: number; value: Vec3 }
export interface KacKeyQuat { time: number; value: [number, number, number, number] }

export interface KacAnimation {
  /** index into the KSM frame list */
  frameIndex: number;
  scales: KacKeyVec3[];
  /** quaternions as stored: x, y, z, w (D3DXQUATERNION order) */
  rotations: KacKeyQuat[];
  translations: KacKeyVec3[];
}

export interface KacAnimationSet {
  name: string | null;
  ticksPerSecond: number;
  /** D3DXPLAYBACK_TYPE: 0 loop, 1 once, 2 ping-pong */
  playbackType: number;
  /** `keyframed`: decoded keys; `compressed`: an opaque D3DX compressed animation set (data kept verbatim) */
  kind: "keyframed" | "compressed";
  animations: KacAnimation[];
  compressed: Uint8Array | null;
}

export interface KacFile {
  version: number;
  sets: KacAnimationSet[];
}

export interface KsmFile {
  version: number;
  center: Vec3;
  maxBoundingRadius: number;
  frames: KsmFrame[];
  animation: KacFile | null;
}

// ---------------------------------------------------------------------------------------------------------------- helpers

/** Bytes per vertex of a fixed-function vertex format (D3DXGetFVFVertexSize). */
export function fvfVertexSize(fvf: number): number {
  let size = 0;
  switch (fvf & 0xe) {
    case 0x2: size += 12; break; // XYZ (also XYZW / XYZ with the 0x4000 flag handled below)
    case 0x4: size += 16; break; // XYZRHW
    case 0x6: size += 16; break; // XYZB1
    case 0x8: size += 20; break; // XYZB2
    case 0xa: size += 24; break; // XYZB3
    case 0xc: size += 28; break; // XYZB4
    case 0xe: size += 32; break; // XYZB5
  }
  if ((fvf & 0x4002) === 0x4002) size += 4; // D3DFVF_XYZW
  if (fvf & 0x10) size += 12; // NORMAL
  if (fvf & 0x20) size += 4; // PSIZE
  if (fvf & 0x40) size += 4; // DIFFUSE
  if (fvf & 0x80) size += 4; // SPECULAR
  const tex = (fvf >> 8) & 0xf;
  for (let i = 0; i < tex; i++) {
    switch ((fvf >> (16 + 2 * i)) & 3) {
      case 0: size += 8; break; // TEXCOORDSIZE2
      case 1: size += 12; break; // 3
      case 2: size += 16; break; // 4
      case 3: size += 4; break; // 1
    }
  }
  return size;
}

class Mem {
  readonly dv: DataView;
  constructor(readonly b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  get size(): number { return this.b.length; }
  /** KMemoryDeserializer::AccessData: the range must lie inside the file. */
  access(offset: number, size: number, what: string): number {
    if (offset + size > this.b.length || offset < 0) throw new KFormatError(`${what}: range ${offset}+${size} outside the ${this.b.length}-byte file`);
    return offset;
  }
  u32(o: number): number { return this.dv.getUint32(o, true); }
  i32(o: number): number { return this.dv.getInt32(o, true); }
  f32(o: number): number { return this.dv.getFloat32(o, true); }
  /** KMemoryDeserializer::RetrieveDupString: u32 length + bytes (no terminator). */
  string(offset: number, what: string): string {
    this.access(offset, 4, what);
    const n = this.u32(offset);
    this.access(offset + 4, n, what);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[offset + 4 + i]!);
    return s;
  }
  color(o: number): Color4 { return [this.f32(o), this.f32(o + 4), this.f32(o + 8), this.f32(o + 12)]; }
  matrix(o: number): Float32Array {
    const m = new Float32Array(16);
    for (let i = 0; i < 16; i++) m[i] = this.f32(o + 4 * i);
    return m;
  }
  copy(o: number, n: number): Uint8Array { return this.b.slice(o, o + n); }
}

/** 72-byte KMEMaterial / KSMMaterial: D3DMATERIAL9 (diffuse, ambient, specular, emissive, power) + texture string offset. */
function readMaterials(m: Mem, offset: number, count: number, what: string): KMaterial[] {
  m.access(offset, 72 * count, `${what} materials`);
  const out: KMaterial[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + 72 * i;
    const tex = m.u32(o + 68);
    out.push({
      diffuse: m.color(o), ambient: m.color(o + 16), specular: m.color(o + 32), emissive: m.color(o + 48),
      power: m.f32(o + 64),
      texture: tex === 0 ? null : m.string(tex, `${what} texture name`),
    });
  }
  return out;
}

function readGeometry(m: Mem, what: string, fvf: number, options: number, nVerts: number, offVerts: number, nFaces: number, offIdx: number, offAttr: number): Pick<KMeshData, "vertexStride" | "vertices" | "indices" | "attributes"> {
  const stride = fvfVertexSize(fvf);
  m.access(offVerts, nVerts * stride, `${what} vertices`);
  const vertices = m.copy(offVerts, nVerts * stride);
  const wide = (options & 1) !== 0;
  const ibytes = 3 * nFaces * (wide ? 4 : 2);
  m.access(offIdx, ibytes, `${what} indices`);
  const indices = wide ? new Uint32Array(3 * nFaces) : new Uint16Array(3 * nFaces);
  for (let i = 0; i < indices.length; i++) indices[i] = wide ? m.u32(offIdx + 4 * i) : m.dv.getUint16(offIdx + 2 * i, true);
  let attributes = new Uint32Array(0);
  if (offAttr !== 0) {
    m.access(offAttr, 4 * nFaces, `${what} attributes`);
    attributes = new Uint32Array(nFaces);
    for (let i = 0; i < nFaces; i++) attributes[i] = m.u32(offAttr + 4 * i);
  }
  return { vertexStride: stride, vertices, indices, attributes };
}

// -------------------------------------------------------------------------------------------------------------------- KME

/** KMEHeader (0x3C bytes): magic, version 512, FVF (the exe insists on 338 = XYZ|NORMAL|DIFFUSE|TEX1), options (bit 0 = 32-bit indices),
 * numMaterials + offset, numVertices + offset, numFaces + offset (indices), attributes offset, center xyz, radius. */
export function parseKme(bytes: Uint8Array): KmeMesh {
  const m = new Mem(bytes);
  m.access(0, 0x3c, "KME header");
  if (m.u32(0) !== KME_MAGIC) throw new KFormatError("not a KME file");
  if (m.u32(4) !== 512) throw new KFormatError(`unsupported KME version ${m.u32(4)}`);
  const fvf = m.u32(8);
  if (fvf !== 338) throw new KFormatError(`unsupported KME vertex format ${fvf}`);
  const options = m.u32(12);
  const nMat = m.u32(16), offMat = m.u32(20), nVert = m.u32(24), offVert = m.u32(28), nFace = m.u32(32), offIdx = m.u32(36), offAttr = m.u32(40);
  if (nMat === 0 || offMat === 0) throw new KFormatError("KME without materials");
  if (nVert === 0 || offVert === 0) throw new KFormatError("KME without vertices");
  if (nFace === 0 || offIdx === 0) throw new KFormatError("KME without faces");
  if (offAttr === 0) throw new KFormatError("KME without attribute table");
  const materials = readMaterials(m, offMat, nMat, "KME");
  const g = readGeometry(m, "KME", fvf, options, nVert, offVert, nFace, offIdx, offAttr);
  return {
    fvf, options, vertexCount: nVert, faceCount: nFace, materials, ...g,
    center: [m.f32(44), m.f32(48), m.f32(52)],
    radius: m.f32(56),
  };
}

// -------------------------------------------------------------------------------------------------------------------- KSM

function readMeshContainer(m: Mem, offset: number, frameCount: number): KsmMeshContainer {
  m.access(offset, 0x38, "KSM mesh container");
  const name = m.u32(offset) !== 0 ? m.string(m.u32(offset), "KSM mesh container name") : null;
  const fvf = m.u32(offset + 4), options = m.u32(offset + 8);
  const nMat = m.u32(offset + 12), offMat = m.u32(offset + 16), nVert = m.u32(offset + 20), offVert = m.u32(offset + 24);
  const nFace = m.u32(offset + 28), offIdx = m.u32(offset + 32), offAttr = m.u32(offset + 36);
  const nBones = m.u32(offset + 40), offBones = m.u32(offset + 44), palette = m.u32(offset + 48);
  const materials = nMat !== 0 && offMat !== 0 ? readMaterials(m, offMat, nMat, "KSM") : [];
  if (nMat === 0 || offMat === 0) throw new KFormatError("KSM mesh container without materials"); // ReadKSM leaves the mesh null and fails later; none shipped
  if (nVert === 0 || offVert === 0 || nFace === 0 || offIdx === 0) throw new KFormatError("KSM mesh container without geometry");
  if (offAttr === 0) throw new KFormatError("KSM mesh container without attribute table");
  const g = readGeometry(m, "KSM", fvf, options, nVert, offVert, nFace, offIdx, offAttr);
  const bones: KsmBone[] = [];
  if (nBones !== 0) {
    if (offBones === 0) throw new KFormatError("KSM bones without table");
    m.access(offBones, 76 * nBones, "KSM bones");
    for (let i = 0; i < nBones; i++) {
      const o = offBones + 76 * i;
      const frameIndex = m.i32(o + 64);
      if (frameIndex < 0 || frameIndex >= frameCount) throw new KFormatError(`KSM bone ${i} refers to frame ${frameIndex} of ${frameCount}`);
      const nInf = m.u32(o + 68), offInf = m.u32(o + 72);
      let vertexIndices = new Uint32Array(0), weights = new Float32Array(0);
      if (nInf !== 0) {
        if (offInf === 0) throw new KFormatError("KSM bone influences without table");
        m.access(offInf, 8 * nInf, "KSM bone influences");
        vertexIndices = new Uint32Array(nInf);
        weights = new Float32Array(nInf);
        for (let k = 0; k < nInf; k++) { vertexIndices[k] = m.u32(offInf + 4 * k); weights[k] = m.f32(offInf + 4 * nInf + 4 * k); }
      }
      bones.push({ offsetMatrix: m.matrix(o), frameIndex, vertexIndices, weights });
    }
  }
  return { name, fvf, options, vertexCount: nVert, faceCount: nFace, materials, bones, numPaletteEntries: palette, ...g };
}

/**
 * KSMHeader (0x20 bytes): magic, version 512, offsetAnimationController, center xyz, maxBoundingRadius, numFrames (<= 255),
 * followed by numFrames x 84-byte KSMFrame {nameOffset, matrix[16], boundingRadius, offsetMeshContainer, indexSibling, indexFirstChild}.
 * Frame 0 is the root and every other frame is referenced exactly once as a sibling or first child (checked like the exe does).
 */
export function parseKsm(bytes: Uint8Array): KsmFile {
  const m = new Mem(bytes);
  m.access(0, 0x20, "KSM header");
  if (m.u32(0) !== KSM_MAGIC) throw new KFormatError("not a KSM file");
  if (m.u32(4) !== 512) throw new KFormatError(`unsupported KSM version ${m.u32(4)}`);
  const offAC = m.u32(8);
  const numFrames = m.u32(28);
  if (numFrames > 0xff) throw new KFormatError(`KSM has ${numFrames} frames (limit 255)`);
  m.access(0x20, 84 * numFrames, "KSM frames");
  const frames: KsmFrame[] = [];
  const refs = new Uint32Array(Math.max(numFrames, 1));
  const containerOffsets: number[] = [];
  for (let i = 0; i < numFrames; i++) {
    const o = 0x20 + 84 * i;
    const nameOff = m.u32(o);
    const sibling = m.i32(o + 76), child = m.i32(o + 80);
    if (sibling >= 0) { if (sibling >= numFrames) throw new KFormatError(`frame ${i}: sibling ${sibling} out of range`); refs[sibling]!++; }
    if (child >= 0) { if (child >= numFrames) throw new KFormatError(`frame ${i}: child ${child} out of range`); refs[child]!++; }
    containerOffsets.push(m.u32(o + 72));
    frames.push({
      name: nameOff === 0 ? null : m.string(nameOff, `frame ${i} name`),
      matrix: m.matrix(o + 4), boundingRadius: m.f32(o + 68),
      sibling: sibling >= 0 ? sibling : -1, firstChild: child >= 0 ? child : -1, meshContainer: null,
    });
  }
  if (numFrames > 0) {
    if (refs[0] !== 0) throw new KFormatError("frame 0 is referenced, so it is not the root");
    for (let i = 1; i < numFrames; i++) if (refs[i] !== 1) throw new KFormatError(`frame ${i} is referenced ${refs[i]} times (expected once)`);
  }
  for (let i = 0; i < numFrames; i++) if (containerOffsets[i] !== 0) frames[i]!.meshContainer = readMeshContainer(m, containerOffsets[i]!, numFrames);
  const animation = offAC !== 0 ? parseKac(bytes.subarray(m.access(offAC, 0, "KSM animation controller")), numFrames) : null;
  return {
    version: m.u32(4), center: [m.f32(12), m.f32(16), m.f32(20)], maxBoundingRadius: m.f32(24), frames, animation,
  };
}

// -------------------------------------------------------------------------------------------------------------------- KAC

/**
 * UnpackKeys (3298A4E0): `numKeys` x {float time; u8 flags} (5 bytes each, packed) followed by the float payload. Per key, flag bits
 * 0..2 carry scale x/y/z, 3..5 translation x/y/z, 6 a quaternion (4 floats); components that are absent keep the previous value
 * (initially scale 1, translation 0, identity rotation). A scale / translation / rotation key is emitted unless bit 7 is set and
 * none of that channel's bits are (mask 0x87 / 0xB8 / 0xC0 == 0x80). The payload must be consumed exactly.
 */
function unpackKeys(m: Mem, offset: number, numKeys: number, size: number): { scales: KacKeyVec3[]; rotations: KacKeyQuat[]; translations: KacKeyVec3[] } {
  if (size < 5 * numKeys) throw new KFormatError("KAC key table overruns its animation");
  const payload = size - 5 * numKeys;
  if (payload % 4 !== 0) throw new KFormatError("KAC key payload is not a multiple of 4 bytes");
  const dataStart = offset + 5 * numKeys;
  let used = 0;
  const f = (): number => {
    if (4 * used >= payload) throw new KFormatError("KAC key payload exhausted");
    return m.f32(dataStart + 4 * used++);
  };
  let sx = 1, sy = 1, sz = 1, tx = 0, ty = 0, tz = 0;
  let q: [number, number, number, number] = [0, 0, 0, 1];
  const scales: KacKeyVec3[] = [], translations: KacKeyVec3[] = [], rotations: KacKeyQuat[] = [];
  for (let i = 0; i < numKeys; i++) {
    const time = m.f32(offset + 5 * i);
    const flags = m.b[offset + 5 * i + 4]!;
    if (flags & 1) sx = f();
    if (flags & 2) sy = f();
    if (flags & 4) sz = f();
    if (flags & 8) tx = f();
    if (flags & 0x10) ty = f();
    if (flags & 0x20) tz = f();
    if (flags & 0x40) q = [f(), f(), f(), f()];
    if ((flags & 0x87) !== 0x80) scales.push({ time, value: [sx, sy, sz] });
    if ((flags & 0xb8) !== 0x80) translations.push({ time, value: [tx, ty, tz] });
    if ((flags & 0xc0) !== 0x80) rotations.push({ time, value: [q[0], q[1], q[2], q[3]] });
  }
  if (used !== payload / 4) throw new KFormatError(`KAC key payload not fully used (${used} of ${payload / 4} floats)`);
  return { scales, rotations, translations };
}

/**
 * KACHeader {magic 'KAC ', version <= 0x100, numAnimationSets, offsets[numAnimationSets]}, then per set (KACAnimationSet, 0x14 bytes)
 * {nameOffset, type (0 keyframed, 1 compressed), double ticksPerSecond, playbackType} followed by
 *   keyframed:  u32 numAnimations, u32 sizes[numAnimations], then the animations back to back, each {i32 frameIndex, u32 numKeys, keys...}
 *   compressed: u32 dataSize, bytes (D3DX compressed animation set, handed to D3DXCreateCompressedAnimationSet)
 */
export function parseKac(bytes: Uint8Array, frameCount: number): KacFile {
  const m = new Mem(bytes);
  m.access(0, 12, "KAC header");
  if (m.u32(0) !== KAC_MAGIC) throw new KFormatError("not a KAC block");
  const version = m.u32(4);
  if (version > 0x100) throw new KFormatError(`unsupported KAC version ${version}`);
  const nSets = m.u32(8);
  if (nSets === 0) throw new KFormatError("KAC without animation sets");
  m.access(12, 4 * nSets, "KAC set offsets");
  const sets: KacAnimationSet[] = [];
  for (let s = 0; s < nSets; s++) {
    const o = m.u32(12 + 4 * s);
    m.access(o, 0x14, "KAC animation set");
    const type = m.u32(o + 4);
    if (type !== 0 && type !== 1) throw new KFormatError(`unknown KAC animation set type ${type}`);
    m.access(o, 0x18, "KAC animation set");
    const nameOff = m.u32(o);
    const name = nameOff === 0 ? null : m.string(nameOff, "KAC set name");
    const ticksPerSecond = m.dv.getFloat64(o + 8, true);
    const playbackType = m.u32(o + 16);
    if (type === 1) {
      const n = m.u32(o + 20);
      m.access(o + 24, n, "KAC compressed data");
      sets.push({ name, ticksPerSecond, playbackType, kind: "compressed", animations: [], compressed: m.copy(o + 24, n) });
      continue;
    }
    const nAnim = m.u32(o + 20);
    m.access(o, 4 * nAnim + 24, "KAC animation sizes");
    let p = o + 24 + 4 * nAnim;
    const animations: KacAnimation[] = [];
    for (let a = 0; a < nAnim; a++) {
      const size = m.u32(o + 24 + 4 * a);
      m.access(p, size, "KAC animation");
      if (size < 8) throw new KFormatError("KAC animation smaller than its header");
      const frameIndex = m.i32(p);
      if (frameIndex < 0 || frameIndex >= frameCount) throw new KFormatError(`KAC animation refers to frame ${frameIndex} of ${frameCount}`);
      const nKeys = m.u32(p + 4);
      animations.push({ frameIndex, ...unpackKeys(m, p + 8, nKeys, size - 8) });
      p += size;
    }
    sets.push({ name, ticksPerSecond, playbackType, kind: "keyframed", animations, compressed: null });
  }
  return { version, sets };
}
